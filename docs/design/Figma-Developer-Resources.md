# Resources for Figma Developers 


1. sundrop Project - 'https://www.figma.com/files/team/1619901914642609912/all-projects?fuid=1619901913274927631'
2. sundrop Boards (2) - 'https://www.figma.com/files/team/1619901914642609912/drafts?fuid=1619901913274927631'
3. Figma MCP Server Tools and prompts - 'https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/#generate_figma_design' 
4. 




## Figma MCP Server Tools and prompts - 'https://developers.figma.Resources (Make → MCP)

### Bringing Make context to your agent
// The Make + MCP integration makes it easier to take prototypes from design to production. By connecting Make projects directly to your agent via MCP, you can extract resources and reuse them in your codebase. This reduces friction when extending prototypes into real applications, and ensures that design intent is faithfully carried through to implementation.

### With this integration, you can:

* Fetch project context directly from Make (individual files or the whole project)
* Prompt to use existing code components instead of starting from scratch
* Extend prototypes with real data to validate and productionize designs faster

###  Steps to fetch resources from Make
* Prompt your agent to fetch context by providing a valid Make link
* Receive a list of available files from your Make project
* Download the files you want to fetch when prompted

### Prompt your client to write to the canvas. For example: 'https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/' 

* "Using this Figma file: <Figma file URL>, create a new page and build a settings screen with auto layout using our existing components."
* "Using this selection: <link to selection>, convert these raw values to variables and update the surrounding components to use them."
* "Using this Figma file: <Figma file URL>, add a new empty state that matches the existing design system."
* Your client should inspect the file, discover the existing structure and conventions, and then use use_figma to make the requested changes. Depending on the client, it may also load the required skill for use_figma before making write actions.

### Review the result in Figma and continue iterating:

* Open the file in Figma and inspect the generated or updated content.
Prompt your client to refine the result, make adjustments, or continue building in the same file.
Tips:

* Include the file URL or link to selection in your prompt so your client knows exactly where to work.

* If you’re making multiple edits in the same conversation, your client will usually infer that you want to keep working in the same file.

* For example, if you prompt "Using this file: <Figma file URL>, create a profile settings screen," you can subsequently prompt things like "Add an empty state below that" or "Now convert the color values in this section to variables."

* Large changes work best incrementally. In general, your client should inspect first, then create or update variables, components, and layouts in smaller steps and validate as it goes.

* When working with a design system, mention the libraries, components, variables, or modes you want the client to use. The best results come from matching what already exists in the file.

### Current limitations
* 20kb output response limit per call
* No assets (image) support yet - including no importing components that have images/videos, or creating GIFs
* Custom fonts aren't supported yet
* Components must be manually published before Code Connect completes
* Beta-level quality — output may need manual review and cleanup


