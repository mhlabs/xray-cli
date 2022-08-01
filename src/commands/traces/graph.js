const dagre = require("dagre");
const clc = require("cli-color");
const readline = require('readline');

let g

async function render(nodes, edges) {
  console.clear()
  const originalNodes = JSON.parse(JSON.stringify(nodes));
  let readjust = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let longestLabel = 0;
  let highestY = 0;
  let width
  let height
  let screenWidth;
  let screenHeight;
  let needsScroll = false;

  let xScale;
  let yScale;
  do {
    readjust = false;
    g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
    });

    g.setDefaultEdgeLabel(function () { return {}; });

    for (const node of nodes) {
      g.setNode(node.id, { label: node.label, width: 1, height: 1, hasError: node.hasError, border: node.border, truncateIfNeeded: node.truncateIfNeeded, longLabel: originalNodes.find(n => n.id === node.id).label, statistics: node.Statistics });
    }

    for (const edge of edges) {
      g.setEdge(edge.from, edge.to);
    }


    dagre.layout(g);
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    longestLabel = 0;
    highestY = 0;
    rows = {};
    for (const node of g.nodes()) {
      const { x, y } = g.node(node);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      longestLabel = Math.max(longestLabel, g.node(node).label.length);
      highestY = Math.max(highestY, y);
      rows[y] = 1;
    }
    
    width = Math.max(maxX - minX, 1);
    height = Math.max(maxY - minY, 1);
    screenWidth = process.stdout.columns - longestLabel;
    screenHeight = 7 * Object.keys(rows).length;

    xScale = (screenWidth - 5) / width;
    yScale = (screenHeight - 10) / height;
    for (const node of g.nodes()) {
      const { x, y } = g.node(node);
      g.node(node).x = Math.round((x - minX) * xScale) + 1;
      g.node(node).y = Math.round((y - minY) * yScale) + 1;
      delete g.node(node).width;
      delete g.node(node).height;

    }
    for (let row = 0; row < screenHeight; row++) {
      const filteredNodes = g.nodes().filter(p => g.node(p).y === row);
      const totalLabelLength = filteredNodes.reduce((acc, p) => acc + g.node(p).label.length, 0);
      const threshold = screenWidth - 2 * filteredNodes.length - 20;
      if (totalLabelLength > threshold) {
        const div = threshold / totalLabelLength;
        for (const node of filteredNodes) {
          if (g.node(node).truncateIfNeeded) {
            nodes.find(p => p.id == node).label = g.node(node).label.substring(0, Math.floor(g.node(node).label.length * div));
          }
        }
        readjust = true;
        needsScroll = true;
      }
    }

  }
  while (readjust)


  for (const edge of g.edges()) {
    let previusPoint = null;
    let count = 0;
    for (const point of g.edge(edge).points) {

      count++;

      point.x = Math.round((point.x - minX) * xScale) + 1;
      point.y = Math.round((point.y - minY) * yScale) + 1;
      if (previusPoint) {
        renderEdge(
          previusPoint.x,
          previusPoint.y,
          point.x,
          point.y,
          Math.floor(Math.random() * 256),
          count === g.edge(edge).points.length,
          edge);
      }
      previusPoint = point;
    }
  }
  let scrollIndex = 0;
  let loop = true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const listener = () => {
    loop = false;
  }
  const emitter = process.stdin.on('data', listener);

  do {
    scrollIndex++;
    for (const node of g.nodes()) {
      addBoxItem(g.node(node), scrollIndex);
    }
    if (needsScroll) {
      writeAt(0, screenHeight + 1, "Press any key to return to the trace menu...");
    } else {
      writeAt(0, screenHeight + 1, "");
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  } while (needsScroll && loop);
  emitter.off('data', listener);
  process.stdin.setRawMode(false);
  process.stdin.resume();
}
var prevChar = "";

function renderEdge(fromX, fromY, toX, toY, color, isLast, edge) {

  const deltaX = Math.max(Math.min(1, (toX - fromX)), -1);
  const deltaY = Math.max(Math.min(1, (toY - fromY)), -1);
  let x = fromX;
  let y = fromY;
  let prevX = Math.floor(x);
  let prevY = Math.floor(y);
  const boxWidth = edge.w.length + 4
  let char = "";
  let safetyExit = 0;
  while (
    (Math.floor(x) !== Math.floor(toX) || Math.floor(y) !== Math.floor(toY)) &&
    safetyExit++ < process.stdout.columns
  ) {
    const flooredX = Math.floor(x);
    const flooredY = Math.floor(y);
    if (flooredX !== Math.floor(toX)) x = x + deltaX;
    if (flooredY !== Math.floor(toY)) y = y + deltaY;
    char = "+";
    if (flooredY === prevY && flooredX !== prevX) char = "─";
    if (flooredY !== prevY && flooredX === prevX) char = "│";
    if (flooredY === prevY && flooredX === prevX) char = prevChar;
    if (flooredY > prevY) {
      if (flooredX == prevX) char = "│";
      if (flooredX > prevX) {
        char = "└";
        addItem({ x: flooredX, y: flooredY - 1, label: "┐" });
      }
      if (flooredX < prevX) {
        char = "┘";
        addItem({ x: flooredX, y: flooredY - 1, label: "┌" });
      }
    }
    if (flooredY < prevY) {
      if (flooredX === prevX) char = "│";
      if (flooredX > prevX) {
        char = "┌";
        addItem({ x: flooredX, y: flooredY + 1, label: "┘" });
      }
      if (flooredX < prevX) {
        char = "┐";
        addItem({ x: flooredX, y: flooredY + 1, label: "└" });
      }
    }
    prevX = flooredX;
    prevY = flooredY;
    addItem({ x: flooredX, y: flooredY, label: char });

    prevChar = char;
  }
  if (isLast) {
    if (prevX > x) addItem({ x: prevX + boxWidth, y: prevY, label: "<" })
    else if (prevX < x) addItem({ x: prevX, y: prevY, label: ">" })
    else if (prevY > y) addItem({ x: prevX, y: prevY, label: "^" })
    else if (prevY < y) addItem({ x: prevX, y: prevY - 1, label: "V" });

  }
}

function writeAt(x, y, str, hasError, isStats) {
  process.stdout.write(clc.move.to(x, y + 2));

  if (str) {
    if (isStats) {
      process.stdout.write(clc.yellow(str));
    } else if (hasError) {
      process.stdout.write(clc.red(str));
    } else {
      process.stdout.write(str);
    }
  }
}

function addItem(node) {
  const x = Math.floor(node.x)
  const y = Math.floor(node.y)
  node.x = x;
  node.y = y;
  writeAt(x, y, node.label);

}
function addBoxItem(node, scrollIndex) {
  const longLabel = node.longLabel;
  if (longLabel.length > node.label.length) {
    let subLabel = longLabel.substring(scrollIndex % longLabel.length, scrollIndex % longLabel.length + node.label.length);
    subLabel += "|" + longLabel.substring(0, node.label.length - subLabel.length);

    writeAt(node.x, node.y, subLabel, node.hasError);
  } else {
    writeAt(node.x, node.y, node.label, node.hasError);
  }
  if (node.statistics) {
    const str = Math.round(node.statistics.TotalResponseTime * 1000) + "ms";
    writeAt(node.x, node.y + 1, str.padEnd(node.label.length, " "), false, true);
  }
  if (node.border) {
    topBorder(node);
    leftBorder(node);
    rightBorder(node);
    bottomBorder(node);
  }
}
function topBorder(node) {
  writeAt(node.x - 1, node.y - 1, "┏".padEnd(node.label.length + 1, "━") + "┓");
}
function bottomBorder(node) {
  const yOffset = node.statistics ? 2 : 1;
  writeAt(node.x - 1, node.y + yOffset, "┗".padEnd(node.label.length + 1, "━") + "┛");
}
function leftBorder(node) {
  writeAt(node.x - 1, node.y, "┃");
  if (node.statistics) {
    writeAt(node.x - 1, node.y + 1, "┃");
  }
}
function rightBorder(node) {
  const length = node.label.length;
  writeAt(node.x + length, node.y, "┃");
  if (node.statistics) {
    writeAt(node.x + length, node.y + 1, "┃");
  }
}

module.exports = {
  render,
}