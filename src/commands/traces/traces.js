const inputUtil = require("../../shared/inputUtil");
const XRay = require("aws-sdk/clients/xray");
const xray = new XRay();
const AWS = require("aws-sdk");
const link2aws = require('link2aws');
const open = require("open");
const chalk = require("chalk");
const graph = require("./graph");
const columns = process.stdout.columns;
let longestRow = 0;
async function run(cmd) {
  console.log("Fetching traces. This can take a while...");

  let token;
  const traces = [];
  let start = getTime(cmd.start);
  let end = getTime(cmd.end);
  if (cmd.absoluteStart) {
    start = new Date(cmd.absoluteStart);
  }
  if (cmd.absoluteEnd) {
    end = new Date(cmd.absoluteEnd);
  }
  try {
    do {

      const traceSummaries = await xray.getTraceSummaries({ StartTime: start, EndTime: end, FilterExpression: cmd.filterExpression, NextToken: token }).promise();
      token = traceSummaries.NextToken;

      traces.push(...traceSummaries.TraceSummaries);
    } while (token);
  } catch (e) {
    if (cmd.filterExpression) {
      console.log(`Failed to fetch traces with filter expression "${cmd.filterExpression}":`, e.message);
    } else {
      console.log("Failed to fetch traces:", e.message);
    }

    return;
  }
  console.clear()
  if (columns < 200) {
    console.log(`For best layout, re-run the command in a terminal with a width of at least 200 characters. You currently have ${columns}.`);
  }
  let menuChoice;
  do {
    const traceChoice = await inputUtil.autocomplete(
      "Select a trace",
      traces.map((t) => {

        const hasError = t.HasFault || t.HasError || t.FaultRootCauses.length || t.ErrorRootCauses.length;
        return { name: `${t.EntryPoint ? t.EntryPoint.Name : "Unknown"} - ${t.Duration} seconds ${hasError ? ERROR : ""}`, value: t }
      }),
    );

    const traceResponse = await xray.batchGetTraces({ TraceIds: [traceChoice.Id] }).promise();

    const trace = traceResponse.Traces[0];
    let minStart = 999999999999999;
    let maxEnd = 0;
    let segments = [];

    let longestName = 0;
    let hasErrors = false;
    for (const segment of trace.Segments) {
      const document = JSON.parse(segment.Document);
      segments.push(document);
      minStart = Math.min(minStart, document.start_time);
      maxEnd = Math.max(maxEnd, document.end_time);
      longestName = Math.max(longestName, document.name.length);
      hasErrors = hasErrors || document.error;
    }
    const width = Math.max(maxEnd - minStart, 1);
    let screenWidth = 100;
    longestRow = 0;
    let traceSegments = getSegments(segments, minStart, maxEnd, width, screenWidth);

    if (longestRow > columns) {
      screenWidth = screenWidth - (longestRow - columns);
      longestRow = 0;
      traceSegments = getSegments(segments, minStart, maxEnd, width, screenWidth);
    }

    traceSegments.unshift({ name: "🗺️  Show service map", value: "map" });
    traceSegments.unshift({ name: "📜 Trace summary", children: getChildren(traceChoice) })
    traceSegments.unshift({ name: "🌐 Open in AWS console", value: `https://${AWS.config.region}.console.aws.amazon.com/xray/home?region=${AWS.config.region}#/traces/${trace.Id}` })
    traceSegments.unshift({ name: "🔙 Back to trace list", value: `back` })
    traceSegments.push({ name: "🚪 Exit", value: `Exit` })

    console.log(chalk.blue(`Start time: `) + new Date(minStart * 1000).toISOString());
    if (typeof maxEnd === "number") {
      console.log(chalk.blue(`End time:   `) + new Date(maxEnd * 1000).toISOString());
    }
    console.log(chalk.blue(`Total duration:   `) + `${trace.Duration} seconds`);
    do {
      menuChoice = await inputUtil.tree("Select a segment (<space> to expand row)", traceSegments);
      if (menuChoice === "map") {
        const traceGraph = await xray.getTraceGraph({ TraceIds: [trace.Id] }).promise();
        const nodes = [];
        const edges = [];
        for (const node of traceGraph.Services) {
          const hasError = node.SummaryStatistics?.FaultStatistics?.TotalCount || node.SummaryStatistics?.ErrorStatistics?.TotalCount;
          nodes.push({
            id: node.ReferenceId,
            label: node.Type === "client" ? "웃" : node.Name,
            hasError: hasError,
            border: node.Type !== "client",
            truncateIfNeeded: node.Type !== "client",
            Statistics: node.SummaryStatistics,
          })
          for (const edge of node.Edges) {
            edges.push({
              from: node.ReferenceId,
              to: edge.ReferenceId,
            })
          }
        }
        await graph.render(nodes, edges);        
      }
      if (typeof menuChoice === "string") {
        if (menuChoice.startsWith("https://")) {
          console.log(`Opening ${menuChoice} in browser...`);
          await open(menuChoice);
        }
      }
    } while (menuChoice !== "Exit" && menuChoice !== "back");
  } while (menuChoice !== "Exit");
}

const BLOCK = "█";
const EMPTY = "░";
const ERROR = chalk.red("✗");
function getSegments(segments, minStart, maxEnd, width, screenWidth) {
  segments = segments.sort((a, b) => a.start_time - b.start_time);

  const traceSegments = [];
  for (const segment of segments) {
    const relativeStart = (segment.start_time - minStart) / width * screenWidth;
    const relativeEnd = (maxEnd - segment.end_time) / width * screenWidth;
    const startFromZero = segment.start_time - minStart;
    const endFromZero = segment.end_time - minStart;
    let block = "".padStart(Math.max(screenWidth - relativeEnd - relativeStart, 1), BLOCK);
    const traceLine = "".padStart(Math.max(relativeStart, 0), EMPTY) + block;
    const duration = segment.end_time - segment.start_time;
    const line = `${traceLine + "".padEnd(Math.max(0, screenWidth - traceLine.length), EMPTY)}${segment.error ? ERROR : " "}${getTimings(startFromZero, endFromZero, duration)} ${getServiceName(segment)}${getScope(segment)}`;
    longestRow = Math.max(longestRow, line.length - 25); // 25 is color code length + inquirer padding
    const seg = {
      name: line,
      value: segment,
    };
    if (segment.subsegments) {
      seg.children = getSegments(segment.subsegments, minStart, maxEnd, width, screenWidth);
    }
    if (segment.error && segment.cause && segment.cause.exceptions) {
      seg.children = seg.children || [];
      seg.children.push({ name: "Error cause", children: segment.cause.exceptions.map(p => { return { name: p.message, children: p.stack ? p.stack.filter(q => q.path).map(p => p.path + ":" + p.line) : [] } }) });
    }
    if (segment.annotations) {
      seg.children = seg.children || [];
      seg.children.push({ name: "Annotations", children: getChildren(segment.annotations) });
    }
    if (segment.aws) {
      seg.children = seg.children || [];
      seg.children.push({ name: "AWS", children: getChildren(segment.aws) });
    }
    traceSegments.push(seg);
    xray.getTraceGraph
  }
  return traceSegments;
}

function getTimings(startFromZero, endFromZero, duration) {
  return chalk.blue(`${startFromZero.toFixed(2)}->${endFromZero.toFixed(2)} (${Math.round(1000 * duration)}ms)`)
}

function getScope(segment) {
  return chalk.green(segment.aws?.operation || segment.name);
}

function getServiceName(segment) {
  if (segment.origin) {
    return chalk.red(`[${segment.origin.replace("AWS::", "")}] `)
  }
  return "";
}

function getChildren(obj, debug) {
  if (!obj)
    return;
  return Object.keys(obj).map(p => {
    if (typeof obj[p] === "string" || typeof obj[p] === "number" || typeof obj[p] === "boolean") {
      if (obj[p].toString().startsWith("arn:")) {
        return { name: `${p}: ${obj[p]} (<enter> to open in console)`, value: generateLink(obj[p]) };
      }
      return { name: `${p}: ${obj[p]}`, value: obj[p] };
    } else if (typeof obj[p] === "object" && !Array.isArray(obj[p])) {
      return { name: p, children: getChildren(obj[p]) };
    } else if (Array.isArray(obj[p])) {
      return { name: p, children: getChildren(obj[p]), value: generateLink(obj[p]) };
    } else {
      return { name: p, children: obj[p], value: generateLink(obj[p]) };
    }
  });
}

function generateLink(arn) {

  if (typeof arn !== "string" || !arn.startsWith("arn:")) {
    return arn;
  }
  try {
    return new link2aws.ARN(arn).consoleLink;
  } catch (e) {
    return arn;
  }
}

function getTime(minutes) {
  const time = new Date();
  time.setMinutes(time.getMinutes() - minutes);
  return time;
}


module.exports = {
  run
};

