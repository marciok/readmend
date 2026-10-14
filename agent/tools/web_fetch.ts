import { disableTool } from "eve/tools";

// The agent only needs its sandbox (bash, read_file); no web access or subagents.
export default disableTool();
