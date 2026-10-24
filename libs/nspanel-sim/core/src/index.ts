// The domain model of the generator: themes and projects as data, with
// validation that says whose rule was broken and where it was measured.
//
// This package is where OUR rules live. The rules that describe the Nextion
// Editor and the compiled format stay in `export/`, which never imports this —
// it has to stand on its own for someone who does not know this project
//.
export * from "./issues.js";
export * from "./schema.js";
export * from "./theme.js";
export * from "./project.js";
