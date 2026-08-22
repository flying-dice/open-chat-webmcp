// `webmcp` adapter — see ./README.md for what lands here and from where.
// Card 79 landed the timeout ladder (./timeouts.mjs); the relay and registry
// modules the README also names are later cards'.

export {
  RELAY_EXECUTE_TIMEOUT_MS,
  SW_CALL_TIMEOUT_MS,
  SW_PULL_TIMEOUT_MS,
  AGENT_LOOP_TOOL_CALL_TIMEOUT_MS,
} from "./timeouts.mjs";
