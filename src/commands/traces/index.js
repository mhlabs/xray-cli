const program = require("commander");
const lib = require("./traces");
program
  .command("traces")
  .alias("t")
  .description("Find and render trace timeline. All parameters are optional.")
  .option("-s, --start <start>", "Start time (minutes ago)", 5)
  .option("-e, --end <end>", "End time (minutes ago)", 0)
  .option("-as, --absolute-start <start>", "Start time (ISO 8601)")
  .option("-ae, --absolute-end <end>", "End time (ISO 8601)")
  .option("-f, --filter-expression <filter>", "Filter expression. Must be inside double or single quotes (\"/')")
  .addOption(new program.Option("-p, --profile <profile>", "AWS profile to use").default("default").env("AWS_PROFILE"))
  .action(async (cmd) => {
    await lib.run(cmd);
  });
