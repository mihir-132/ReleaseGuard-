# Project Coding Rules

This repository is currently empty. Add project-specific, non-obvious coding rules here once the stack is established.

Examples of what belongs here (after setup):

* Custom utilities that replace standard approaches (with file paths)
* Non-standard patterns unique to this project
* Required import orders or naming conventions not enforced by linters
* Hidden dependencies or coupling between components


## Project Conventions



\- The Node.js server uses ES Modules because server/package.json sets `"type": "module"`.

\- Use `import` / `export` syntax for all server-side JavaScript modules.

\- Do not use CommonJS `require()` or `module.exports`.

\- Include `.js` extensions in local ESM imports.

