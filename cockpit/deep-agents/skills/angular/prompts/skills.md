# Deep Agents Skills (Angular)

SkillsMiddleware puts a metadata index — name, description, and instruction path — in the system prompt. Skill bodies and references are loaded through read_file when requested. The shared /skills/ mount is enforced read-only; thread-local notes remain writable.

PrivateStateAttr excludes Skills metadata and load errors from declared input/output schemas. In the pinned graph these keys can still appear in root values and checkpoints. A named custom event is an additional live source. The Angular panel prefers that event and falls back to agent.value(); its checkpoint label names the fallback rather than proving a reopened thread.

The Angular path projection uses read_file arguments only: it shows requested paths, including failed requests, without validating tool results. Its body not read label means no matching request was observed. The React preview separately marks successfully inspected results. This Skills contract makes no inference about Memory.
