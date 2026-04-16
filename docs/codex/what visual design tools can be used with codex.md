Google Search Title:
====================

what visual design tools can be used with codex

  

Google Search AI Overview:
==========================

  

OpenAI Codex works with several visual design and prototyping tools, primarily by enabling a roundtrip between visual design canvases and generated code. The integration is largely facilitated through the

**Figma MCP (Model Context Protocol) server**, allowing for seamless, bidirectional workflows between design and development. 

Here are the primary visual design tools used with Codex: 

1\. Figma (Primary Integration) 

*   **Bidirectional Sync:** Codex can pull design context (layouts, styles, variables, components) from Figma to generate React, Tailwind, or CSS code.
*   **Design-to-Code:** You can take a Figma frame URL, and instruct Codex to implement it, utilizing the project's existing design system components.
*   **Code-to-Design:** Codex can turn a live, running interface back into fully editable Figma frames, enabling rapid prototyping.
*   **Playwright Verification:** Codex uses the Playwright skill to compare the coded UI against the Figma reference, checking for visual parity and responsiveness. 

2\. Framer 

*   **Speed + Control:** Framer is used for visual design freedom, while Codex provides the momentum to turn those designs into functioning, high-performance websites. 

3\. Sketch 

*   **Prototyping:** Used to create high-fidelity design pages, which can then be converted into code. 

4\. Shuffle.dev (Tailwind/Bootstrap Editor) 

*   **Visual-to-Code:** A visual editor that allows you to construct UI using Tailwind, Bootstrap, or Material-UI and then hand off the design to Codex for code implementation. 

5\. SuperDesign (IDE Integrated) 

*   **AI Agent:** An open-source, AI-powered plugin that operates directly inside code editors (VS Code, Cursor) to generate UI mockups and components from text prompts. 

6\. General Graphic/Vector Tools 

*   **Adobe Illustrator & Affinity Designer:** Used for creating vector components, icons, and detailed graphical elements that are then imported into front-end projects handled by Codex. 

Key Workflow Features 

*   **Visual Inputs:** You can upload screenshots, wireframes, or system diagrams directly into the Codex CLI/editor to have the model interpret and generate code based on them.
*   **Playwright (Live Preview):** Codex can open a running app in a real browser to compare the implementation to design screenshots, iterating until the layout matches.
*   **ImageGen Skill:** A built-in skill that allows Codex to generate images and visual assets to be used in UI mockups. 

Codex is generally used through IDE extensions for **VS Code, Cursor, and Windsurf**, which allow for direct integration of these visual tools. 

*   [](https://developers.openai.com/codex/use-cases/figma-designs-to-code#:~:text=Turn%20Figma%20selections%20into%20polished,design%20context%20and%20visual%20checks.&text=Use%20Codex%20to%20pull%20design,iterate%20until%20it%20looks%20right.)
    
    Turn Figma designs into code | Codex use cases - OpenAI Developers
    
    Turn Figma designs into code. Turn Figma selections into polished UI with structured design context and visual checks. ... Use Cod...
    
    ![](data:image/png;base64,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)
    
    OpenAI Developers
    
    ![](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5OjcBCgoKDQwNGg8PGjclHyU3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3N//AABEIAFEAUgMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAAABAIDBQEHBv/EAC4QAAEEAgIABAMIAwAAAAAAAAEAAgMRBCEFMRIiMkFxkZITUWFygZOxwQYUVP/EABoBAAIDAQEAAAAAAAAAAAAAAAIDAQQGBQD/xAAdEQEBAAIDAQEBAAAAAAAAAAAAAQIRAyExEkEF/9oADAMBAAIRAxEAPwAbIOlYxoc9rj7bSMTrPaehd5Vp8ppVq4KbDsKq6C4Hpei7WhE7pPwlZET9haWOdJHJEbPxDpNRi6SsG05EqedHFzABSta3agwVSt6VbKm4uEbQul20KBPJ43bCdhNhZjX7TmO8rSZFnfFpQJ2uXpaTeB5d7Q5vHZBBFjy0k5ZY4+0my3wpC7a18U2EuzgOXGzx0/0q/Cv0uBa4GiD2CkcmWOU6qNWXtpwHSej6SkIFBOxLn8hmK5vsp9hRYCSpigLSKbENIQhee28gjTUR8wSjO01GNhaWhPxUJYvzt/leu8vyOPxODPnZZeIIaLixpcdmuh8V49G+pIy40A8En9V7Nkw42dA6LIjingfRLXgOad2D86K5H9D3EXF+kv8AHuax+f4tmfiMljY4+FzJW0WuoWPuNX2NKvh8HFkGVNJjxvkfly25zQenkBOcdx+HxeG3FwII4IGDTW++qsnsnQ2dqrgHNfizPY4OacqYgjo+cqhLZjTbrZwYWL/zQ/thZvLQxRTQ/ZRtZ4gb8IpX4fCw4uWMluRkve0uoPfenbrrYsk79zu6FR5kXNj/AAP9IJbtGU6JxihaCrGtXCp2DSrwlCla6pQ8bj9kywpVhVzXLT0FNA2rY2g+5+aWa5MRnaXlNhOQxi+z81v8PyufgRf6+NI37K7DXMBo/gsGF2wtLD9QVTlwxs1YiWy9PrcfleSkALns+gK8vmyHtfO6yOqFJDAcHALTjC4/JNVZnjvQUXNoWrFF5B7S0lyDaEeIfehNC8XaVa07VDVNrtrTl2G2FMxutJRuTURQZQJ+E9LUxD0siDsLXxK1u1W5fHpG3gTFtbW1DJ5QsGAgC04zKLBorlcuH1ejZdNcu90tJJ7Wl48wPNHR+K5LJQ/FKmFibU/EEJbxlCP5Bt5K1SahC0j1XxpyDsLiEOQT0fa0cLsLqFX5fExsQ+lTchC519HUovW34piX1/qhCXl6hWe0IQvBf//Z)
    
*   [](https://www.figma.com/blog/introducing-codex-to-figma/#:~:text=These%20selection%20URLs%20are%20linked,components%20as%20much%20as%20possible.)
    
    Building Frontend UIs with Codex and Figma
    
    Feb 26, 2026 — Building frontend UIs with Codex and Figma. ... With Codex to Figma, teams can bring real, running interfaces into Figma to explor...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAIAAAD9b0jDAAABUUlEQVR4AWOgHxgF0mxsm9XVXxgZQZGu0YsMBFrnpybDy0ayoUCD/pubI5Ch+f8y8/9FEARiA40mzcQWWVmYcZiGIsxtsZYlwdDlKirEGAoMBBIMrZGWJsbQclMp0kLglr4+yCwzfTiCGlpoAERA9rUEPXISwDQFyae25RD0zLrmfJzCxRCei8XhF5pKJ9qKkmOii0ZTQ8B/OOoO/A8SnXyRYed/ENr2nyG6kTQT1cW9gKa0+yNQr9d/htYNDHuAxkEQ2GgdWxIMDTaci26oK9CUX0Cz4AhkQd4sGhtKf+8jIgpoUK8rDHlBIwpk7h5YRJEBhIptHddNgSC3nQshgiDXuSUzkAfkVsWrXi5VPJsLQUA2A4VAMN4UaIrK6UI4ooKhEu3e1DdUONMazVDFnekMlAOgKXBzgQxggFDBUBYxXmAgAI0GxhhfkC7DwIJRAAA6ZTBaejThFQAAAABJRU5ErkJggg==)
    
    Figma·
    
    ![](data:image/jpeg;base64,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)
    
    0:08
    
*   [](https://medium.com/@alphadesignglobal/is-framer-the-best-for-creating-visually-stunning-restaurant-or-hospitality-websites-7bb5e73f0a0f)
    
    Framer
    
    The Core Concept: What Makes Framer a Fit for Hospitality? Framer is a visual design tool first, and a website builder second.
    
    ![](data:image/png;base64,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)
    
    Framer
    

Show all

*   [](https://developers.openai.com/codex/use-cases/figma-designs-to-code#:~:text=Turn%20Figma%20selections%20into%20polished,design%20context%20and%20visual%20checks.&text=Use%20Codex%20to%20pull%20design,iterate%20until%20it%20looks%20right.)
    
    Turn Figma designs into code | Codex use cases - OpenAI Developers
    
    Turn Figma designs into code. Turn Figma selections into polished UI with structured design context and visual checks. ... Use Cod...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcT0Nq8xE7MRnZYQVRdTYmtFx7h0aBgFF922T2-AGiozWZVCQdQj-AcnpocdaFGncsnhtn49jQ)
    
*   [](https://www.figma.com/blog/introducing-codex-to-figma/#:~:text=These%20selection%20URLs%20are%20linked,components%20as%20much%20as%20possible.)
    
    Building Frontend UIs with Codex and Figma
    
    Feb 26, 2026 — Building frontend UIs with Codex and Figma. ... With Codex to Figma, teams can bring real, running interfaces into Figma to explor...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAIAAAD9b0jDAAABUUlEQVR4AWOgHxgF0mxsm9XVXxgZQZGu0YsMBFrnpybDy0ayoUCD/pubI5Ch+f8y8/9FEARiA40mzcQWWVmYcZiGIsxtsZYlwdDlKirEGAoMBBIMrZGWJsbQclMp0kLglr4+yCwzfTiCGlpoAERA9rUEPXISwDQFyae25RD0zLrmfJzCxRCei8XhF5pKJ9qKkmOii0ZTQ8B/OOoO/A8SnXyRYed/ENr2nyG6kTQT1cW9gKa0+yNQr9d/htYNDHuAxkEQ2GgdWxIMDTaci26oK9CUX0Cz4AhkQd4sGhtKf+8jIgpoUK8rDHlBIwpk7h5YRJEBhIptHddNgSC3nQshgiDXuSUzkAfkVsWrXi5VPJsLQUA2A4VAMN4UaIrK6UI4ooKhEu3e1DdUONMazVDFnekMlAOgKXBzgQxggFDBUBYxXmAgAI0GxhhfkC7DwIJRAAA6ZTBaejThFQAAAABJRU5ErkJggg==)
    
    Figma·
    
    ![](https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcRBGh5i1u1Mf6m1JhlW1JqEsJGsS-N13dzZ21Z_nE9gJ9K6ura3idgJfZg9sNqTtLyxeMekrNs)
    
    0:08
    
*   [](https://developers.openai.com/codex/use-cases/frontend-designs#:~:text=Codex%20works%20best%20when%20the,interactive%20skill%20enabled%20in%20Codex.)
    
    Build responsive front-end designs | Codex use cases
    
    \- Use $playwright-interactive to check that the UI matches the references and iterate as needed until it does. \* Introduction. Whe...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTY-LPoJ7EJwYQ8rBhs7IxdM-hMw7RT9OL43So7_MlLudNqPEwAZ8NPnH2GjadA8YIQkfXgqA)
    
*   [](https://developers.openai.com/codex/ide/#:~:text=If%20you%20want%20to%20use,the%20activity%20bar%20orientation%20first:)
    
    IDE extension – Codex
    
    Extension setup. The Codex IDE extension works with VS Code forks like Cursor and Windsurf. You can get the Codex extension from t...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAP1BMVEVHcEwAgPgAgPgAgPcAgPcAgPcAgPcAgPcAgPcAgPcAd/dzsvq+2/2Kvvtfpvru+P/Z6/77/v83lvmnzfwbjPhuMd/TAAAACnRSTlMAF0adyun/9k+LLZxzywAAAXZJREFUeAFkUlmWwyAMC03qZITxAtz/rPNiaLpEvwhJCC1vpMe6PYn2bT3Sckf6e9KF55pux/SDvy9K2uiG7YNx7BQAgDdjP677r/PMXOhN2tOXPkSN2byUkis+XV75vBFA7mqugpE0BKY+M0DNuQIoXgbjlFinv1Zk0wxUAppeEin66ebe4Q2o7J6pq4zG0nLEfTPRDhUUNSlu3fKQeAwH0V5PQlPV1kHFfcZcl20GPAnuuWe1DIjx7HPZw+EkEOJ1cDcBtCBCLBGhGVVlimTQ3FxQbHgEgaoLuoVx6FiG+CQ8h4RWUFYVdHYhy8iDsEfI6IEjvTlrEJgxQq7DQ8W0kbgKgiAu85mPQYiiPZo+LdRnUcesGsZAzxVozp2MBa+q5293bx2gs2kgK2hgvb4b4mpsWgggbS9C+hgMcmtFrRT2ck37e9IAajHjjJ9hz9FO0n201+wn7rP/H76MQzjrIZQwI2deTqz5m4OZhR0oycLMhCQNACpMHlEZrAKTAAAAAElFTkSuQmCC)
    
    OpenAI Developers·OpenAI
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcSza1JUedH__bmofeIX5PoR4NsQ_f7AiBhREw0l5tF2bitLipG4vxjZ2MHxlc9B38DML4BYqKA)
    
    7:01
    
*   [](https://www.facebook.com/jamil.woc/photos/openaiis-codex-pencildev-consistent-cool-design-%F0%9D%97%A7%F0%9D%97%B5%F0%9D%97%B6%F0%9D%98%80-%F0%9D%97%B6%F0%9D%98%80-%F0%9D%97%B5%F0%9D%97%BC%F0%9D%98%84-%F0%9D%97%9C-%F0%9D%97%AE%F0%9D%97%BD%F0%9D%97%BD%F0%9D%97%BF%F0%9D%97%BC%F0%9D%97%AE%F0%9D%97%B0%F0%9D%97%B5%F0%9D%97%B2%F0%9D%97%B1-%F0%9D%97%B6%F0%9D%98%81first/1604533580821758/#:~:text=OpenAII's%20Codex%20+%20Pencil.dev%20=,as%20a%20Java%20backend%20engineer.)
    
    OpenAII's Codex + Pencil.dev = Consistent Cool Design. This ...
    
    \### ✨ SuperDesign: Open-Source AI Design Agent for Your IDE 🚀 Transform how you build user interfaces—meet \*\*SuperDesign\*\*! Super...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAV1BMVEVHcEwHZv/O1v8HaP8Haf8IZ/8IaP8IZv8IZ/8IaP/r7/8IZ/8IZ/8AW/////+fsf8HZv////8AYP8AWf8AZP+Vqf/V3P8IZ/9wlP9jiv+tvP+Lpf82c/8XNRKaAAAAEHRSTlMAM/2GGN1h9exC+8LBwcGFy8UXywAAAPNJREFUKJFlk+kSgyAMhDnUQe2BQQtU3/85yxEi0P3l+E1gkyyMFXG5KmvVKjnrNSlNUlODhlE3GoebzVZ3sjMx+reDiYLwiXSgOrCHWJaPcIHafDLdB27L+sbSMfkk5rca6uiZejBLC1XoncxcSM7T7+kPZ7K78TIAmWnJHgTPyD7mbna9r4Sjh4phk7sxqVLEIeCxFiG1mISGLB67+xrmUqvQENRwMcWQ/D9WmNIKxwk4/01uvXMXGuJlfGFZR66iGahq8H99TtXKejjWy+4gLhtj0sG5CVgD74DlaNawjmYKNRxlAF2o03N4v0JOxLN6Dj8GhSiE70/PKAAAAABJRU5ErkJggg==)
    
    Facebook·Shalinda Jayasinghe
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSe4Oc7-2HIXwOEhSu9Zh_9l77YvzrrSUrGPioB8ujT5jFC3P8Gx0Mm6BrDX5kzxM7ECOc0-_0)
    
    1:01
    
*   [](https://openai.com/index/introducing-the-codex-app/#:~:text=The%20Codex%20app%20includes%20a%20library%20of%20skills%20for%20tools,with%20professional%20formatting%20and%20layouts.)
    
    Introducing the Codex app - OpenAI
    
    Feb 2, 2026 — The Codex app includes a library of skills for tools and workflows that have become popular at OpenAI, with a few highlighted belo...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcSuZe2Z0CbuXhnmXqGUadp18zhmaGq50vhW98XS2Ae8oLsk4VeiI64o70p_IqKehOTvmeLVUQ)
    
*   [](https://shuffle.dev/codex#:~:text=Try%20Visual%20Editor-,Products,WordPress%20AI%20Theme%20Builder)
    
    Visual Editor for Codex - Shuffle
    
    Shuffle's Editors \* Tailwind Editor. \* An online editor for Bootstrap. \* An online editor for Material-UI. ... \* Supporting tools.
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://shuffle.dev&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    shuffle.dev
    
    ![](https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcQyEWc9ll9x8Z8DiWOlVsogV1Rf7KzGt6_-0TFWDPzHZanwzrRcn0-qzP1mxw)
    
*   [](https://codesignal.com/learn/courses/introduction-to-codex-1/lessons/expending-codex-with-visual-and-web-context#:~:text=Visual%20context%20helps%20Codex%20act,a%20matching%20React%20component%20layout.)
    
    Expanding Codex with Visual and Web Context
    
    You've seen how it can refactor files, create new ones, and follow your project's rules automatically. Now, it's time to go a step...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAP1BMVEUQYvsQYvsQYvsQYvsQYvsAXfwJX/yDqv6zy/6St/5qm/1MiP0wd/wDZ/zu9P/6/P/d6f/G2f+jwP52o/0QYvsf4sSCAAAAFXRSTlMdq/r/rv///////////////////7FKCVAdAAAA6klEQVR4AX3S227EIAwEUBqH+2CbZP//W2urQrtqQ+f1gMVYhPB10GOO04y2OcOxxyNsyfKD0ZPIQyl63phLbR3D3GSgt1rywphZLDov4JoqFs5xIXTCTqvUKmpTMBULKRbuwBhTdY4BdC5mC5uwD80i2QeztDcmUr5K6WBGL+VipfRRpUofoDhnJIwuNdIHwt96U2t0+3vxiTSqV2hEzSvZxYVrR10LUdHu+1m4kqwQwMXX+Ae90H2zlXhE6JyK9ISml8gVaYNdpO8wDdWRNkgx50g7TEDaojH9wn3+/5rnHl8hnMfm3it8A12eERq34RBrAAAAAElFTkSuQmCC)
    
    CodeSignal·
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
*   [](https://www.threads.com/@smiling.ank.1/post/DWatP0Fl013/open-ai-just-pushed-codex-past-the-editor-by-rolling-out-plugins-that-connect#:~:text=OpenAI%20just%20pushed%20Codex%20past%20the%20editor,code%20instead%20of%20only%20the%20code%20itself.)
    
    OpenAI just pushed Codex past the editor by rolling out plugins that ...
    
    Mar 28, 2026 — OpenAI just pushed Codex past the editor by rolling out plugins that connect it to tools like Slack, Figma, Notion, Gmail, and Goo...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.threads.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Threads
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR_hl5vnByBJfnQG6nJXo-cS-YWAdmqCL1UwsqWzosymmaWiT2H)
    
*   [](https://developers.openai.com/blog/building-frontend-uis-with-codex-and-figma#:~:text=When%20code%20and%20the%20canvas%20are%20connected%2C,high%2Dquality%20application%20experiences%20without%20compromising%20on%20speed.)
    
    Building frontend UIs with Codex and Figma
    
    Feb 26, 2026 — When code and the canvas are connected, you can move fluidly between execution and exploration. This roundtrip process unlocks the...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcTZXEs5Du1JXOYsG4NEGVwSAouxuObXWTBV2lDgWd3lOThbhuWK)
    
*   [](https://www.youtube.com/watch?v=P7HXxl14dCA)
    
    How designers prototype using the Codex app and Figma - YouTube
    
    Feb 4, 2026 — Takeaways: One-click install for Figma with the Figma skill. Pasting a Figma link is enough to kick off a strong first pass. Codex...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://www.youtube.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    YouTube
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcSlGc3BTOgIGjSwUnbxl55WtB-YeK01xSFaexPKbNJSSJoOcNuT)
    
*   [](https://www.kinexmedia.com/blog/ux-design-tools/#:~:text=Framer%20has%20both%20creative%20freedom%20like%20Figma,handles%20the%20technical%20aspects%20behind%20the%20scenes.)
    
    Top 10 Free UX Design Tools For Beginners in 2026
    
    Sep 30, 2024 — Framer has both creative freedom like Figma and functionality like Webflow. This means designers can conveniently focus on creatin...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.kinexmedia.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Kinex Media Inc.
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcTzzaNNBkwNSanZU-YVGLXDs2u2Ljxak7sxalwaTA-ug3LP6bgE)
    
*   [](https://www.justinmind.com/web-design/tools#:~:text=With%20Framer%2C%20design%20and%20development%20meet.%20It,ensure%20their%20designs%20are%20functional%20and%20polished.)
    
    Best web design tools: the ultimate guide
    
    Jul 31, 2024 — With Framer, design and development meet. It allows you to create high-fidelity prototypes and even production-ready sites in one ...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.justinmind.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Justinmind
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQrFZQk-QcMN2r223r3InHzaNr26kqU4-zxC4NkoewYS6YW4L-V)
    
*   [](https://www.phaedrasolutions.com/blog/best-ui-design-tools#:~:text=5.%20Affinity%20Designer%20%E2%80%93%20Best%20Budget%20Tool,layouts%2C%20and%20visuals%20without%20breaking%20the%20bank.)
    
    Top 20 UI Design Tools Every Modern Designer Needs
    
    Aug 6, 2025 — 5\. Affinity Designer – Best Budget Tool for UI & Vector Work Affinity Designer is a solid, budget-friendly alternative to Adobe Il...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://www.phaedrasolutions.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Phaedra Solutions
    
    ![](https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcQEkhX7HnrxZBdfcWgqMJgs49o_E5qQuKyhlNyzR7i5qSJ7FnBC)
    
*   [](https://localazy.com/blog/21-must-know-design-tools-and-frameworks-for-unforgettable-digital-products#:~:text=11.%20Affinity%20Designer%20\(Illustrator%20Alternative\)%20%F0%9F%94%97%20Affinity,gradients%2C%20filters%2C%20effects%2C%20and%20robust%20export%20options.)
    
    21 must-know design tools and frameworks for building unforgettable digital products
    
    Feb 22, 2024 — 11\. Affinity Designer (Illustrator Alternative) 🔗 Affinity Designer is a vector graphics-based alternative software to Adobe Illu...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://localazy.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Localazy
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcTEA70zfGqzzDCC9dL3eR3t4WbfLwgoXJlnBNCZKcROLHoQNvU5)
    
*   [](https://medium.com/@alphadesignglobal/is-framer-the-best-for-creating-visually-stunning-restaurant-or-hospitality-websites-7bb5e73f0a0f)
    
    Framer
    
    The Core Concept: What Makes Framer a Fit for Hospitality? Framer is a visual design tool first, and a website builder second.
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Framer
    
*   [](https://medium.com/authority-magazine/ai-and-automation-alex-sandoval-of-allie-systems-on-how-to-effectively-harness-ai-technology-in-00bfecc8507f)
    
    Figma
    
    Figma, a product design tool. I love user-centered design. Figma is a great visual tool that gets people to workshop things and re...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Figma
    
*   [](https://www.modelo.io/damf/article/2024/10/09/1228/how-to-insert-objects-into-blender)
    
    Blender
    
    Blender is a powerful 3D modeling software that allows you to create stunning visual designs. One of the key features of Blender i...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Blender
    
*   [](https://blueskygraphics.co.uk/cut-text-effect-with-adobe-illustrator/)
    
    Adobe Illustrator
    
    Discover graphic design's Adobe Illustrator-fuelled possibilities Adobe Illustrator is a powerful and versatile graphic design too...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Adobe Illustrator
    
*   [](https://peoplemanagingpeople.com/tools/best-ai-strategy-tools/)
    
    Canva
    
    Canva Canva makes visual design easy with smart layout tools. Canva is a graphic design platform used by individuals and businesse...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Canva
    
*   [](https://blueskygraphics.co.uk/image-inside-text-tutorial-with-adobe-indesign/)
    
    Adobe InDesign
    
    Adobe InDesign is a powerful graphic design tool used by professionals around the world. It's no secret that Adobe InDesign offers...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Adobe InDesign
    
*   [](https://corizo.in/what-are-the-best-ui-ux-designing-tools-for-windows/)
    
    Affinity Designer
    
    6\. Affinity Designer While not solely a UI/UX ( UI/UX design ) tool, Affinity Designer is a robust vector graphic design software ...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Affinity Designer
    
*   [](https://www.mockplus.com/blog/post/how-to-become-a-full-stack-developer)
    
    Sketch
    
    Sketch is a well-known design tool that enables designers and developers to visualize their design ideas from scratch. It comes wi...
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)
    
    Sketch
    

*   [](https://developers.openai.com/codex/use-cases/figma-designs-to-code#:~:text=Turn%20Figma%20selections%20into%20polished,design%20context%20and%20visual%20checks.&text=Use%20Codex%20to%20pull%20design,iterate%20until%20it%20looks%20right.)
    
    Turn Figma designs into code | Codex use cases - OpenAI Developers
    
    Turn Figma designs into code. Turn Figma selections into polished UI with structured design context and visual checks. ... Use Cod...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcS-65MgGnThrD7CmDfGTmPgHnVaRGos2Sew6EYWQAZa_LrEDeko)
    
*   [](https://www.figma.com/blog/introducing-codex-to-figma/#:~:text=These%20selection%20URLs%20are%20linked,components%20as%20much%20as%20possible.)
    
    Building Frontend UIs with Codex and Figma
    
    Feb 26, 2026 — Building frontend UIs with Codex and Figma. ... With Codex to Figma, teams can bring real, running interfaces into Figma to explor...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAIAAAD9b0jDAAABUUlEQVR4AWOgHxgF0mxsm9XVXxgZQZGu0YsMBFrnpybDy0ayoUCD/pubI5Ch+f8y8/9FEARiA40mzcQWWVmYcZiGIsxtsZYlwdDlKirEGAoMBBIMrZGWJsbQclMp0kLglr4+yCwzfTiCGlpoAERA9rUEPXISwDQFyae25RD0zLrmfJzCxRCei8XhF5pKJ9qKkmOii0ZTQ8B/OOoO/A8SnXyRYed/ENr2nyG6kTQT1cW9gKa0+yNQr9d/htYNDHuAxkEQ2GgdWxIMDTaci26oK9CUX0Cz4AhkQd4sGhtKf+8jIgpoUK8rDHlBIwpk7h5YRJEBhIptHddNgSC3nQshgiDXuSUzkAfkVsWrXi5VPJsLQUA2A4VAMN4UaIrK6UI4ooKhEu3e1DdUONMazVDFnekMlAOgKXBzgQxggFDBUBYxXmAgAI0GxhhfkC7DwIJRAAA6ZTBaejThFQAAAABJRU5ErkJggg==)
    
    Figma·
    
    ![](https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcTKbxsaHtfBzE5jtfHHOj44m0PicRrmTDFAjX4x17ooyF7YJQqO)
    
    0:08
    
*   [](https://developers.openai.com/codex/use-cases/frontend-designs#:~:text=Codex%20works%20best%20when%20the,interactive%20skill%20enabled%20in%20Codex.)
    
    Build responsive front-end designs | Codex use cases
    
    \- Use $playwright-interactive to check that the UI matches the references and iterate as needed until it does. \* Introduction. Whe...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcRDaxmAV6Cc_zT-10yWUVp_FqUC6Fh10UPFHIbk0dmctbzSyNOG)
    
*   [](https://developers.openai.com/codex/ide/#:~:text=If%20you%20want%20to%20use,the%20activity%20bar%20orientation%20first:)
    
    IDE extension – Codex
    
    Extension setup. The Codex IDE extension works with VS Code forks like Cursor and Windsurf. You can get the Codex extension from t...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAP1BMVEVHcEwAgPgAgPgAgPcAgPcAgPcAgPcAgPcAgPcAgPcAd/dzsvq+2/2Kvvtfpvru+P/Z6/77/v83lvmnzfwbjPhuMd/TAAAACnRSTlMAF0adyun/9k+LLZxzywAAAXZJREFUeAFkUlmWwyAMC03qZITxAtz/rPNiaLpEvwhJCC1vpMe6PYn2bT3Sckf6e9KF55pux/SDvy9K2uiG7YNx7BQAgDdjP677r/PMXOhN2tOXPkSN2byUkis+XV75vBFA7mqugpE0BKY+M0DNuQIoXgbjlFinv1Zk0wxUAppeEin66ebe4Q2o7J6pq4zG0nLEfTPRDhUUNSlu3fKQeAwH0V5PQlPV1kHFfcZcl20GPAnuuWe1DIjx7HPZw+EkEOJ1cDcBtCBCLBGhGVVlimTQ3FxQbHgEgaoLuoVx6FiG+CQ8h4RWUFYVdHYhy8iDsEfI6IEjvTlrEJgxQq7DQ8W0kbgKgiAu85mPQYiiPZo+LdRnUcesGsZAzxVozp2MBa+q5293bx2gs2kgK2hgvb4b4mpsWgggbS9C+hgMcmtFrRT2ck37e9IAajHjjJ9hz9FO0n201+wn7rP/H76MQzjrIZQwI2deTqz5m4OZhR0oycLMhCQNACpMHlEZrAKTAAAAAElFTkSuQmCC)
    
    OpenAI Developers·OpenAI
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT7AWTMDkA_2R-mnVMkk_saNMylsW2m2nOPR1E_wn1BHeuCxLG5)
    
    7:01
    
*   [](https://www.facebook.com/jamil.woc/photos/openaiis-codex-pencildev-consistent-cool-design-%F0%9D%97%A7%F0%9D%97%B5%F0%9D%97%B6%F0%9D%98%80-%F0%9D%97%B6%F0%9D%98%80-%F0%9D%97%B5%F0%9D%97%BC%F0%9D%98%84-%F0%9D%97%9C-%F0%9D%97%AE%F0%9D%97%BD%F0%9D%97%BD%F0%9D%97%BF%F0%9D%97%BC%F0%9D%97%AE%F0%9D%97%B0%F0%9D%97%B5%F0%9D%97%B2%F0%9D%97%B1-%F0%9D%97%B6%F0%9D%98%81first/1604533580821758/#:~:text=OpenAII's%20Codex%20+%20Pencil.dev%20=,as%20a%20Java%20backend%20engineer.)
    
    OpenAII's Codex + Pencil.dev = Consistent Cool Design. This ...
    
    \### ✨ SuperDesign: Open-Source AI Design Agent for Your IDE 🚀 Transform how you build user interfaces—meet \*\*SuperDesign\*\*! Super...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAV1BMVEVHcEwHZv/O1v8HaP8Haf8IZ/8IaP8IZv8IZ/8IaP/r7/8IZ/8IZ/8AW/////+fsf8HZv////8AYP8AWf8AZP+Vqf/V3P8IZ/9wlP9jiv+tvP+Lpf82c/8XNRKaAAAAEHRSTlMAM/2GGN1h9exC+8LBwcGFy8UXywAAAPNJREFUKJFlk+kSgyAMhDnUQe2BQQtU3/85yxEi0P3l+E1gkyyMFXG5KmvVKjnrNSlNUlODhlE3GoebzVZ3sjMx+reDiYLwiXSgOrCHWJaPcIHafDLdB27L+sbSMfkk5rca6uiZejBLC1XoncxcSM7T7+kPZ7K78TIAmWnJHgTPyD7mbna9r4Sjh4phk7sxqVLEIeCxFiG1mISGLB67+xrmUqvQENRwMcWQ/D9WmNIKxwk4/01uvXMXGuJlfGFZR66iGahq8H99TtXKejjWy+4gLhtj0sG5CVgD74DlaNawjmYKNRxlAF2o03N4v0JOxLN6Dj8GhSiE70/PKAAAAABJRU5ErkJggg==)
    
    Facebook·Shalinda Jayasinghe
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcT4t7tt5U4i9YhJW1pq9-bddVKlAey2hcKo2ojhhXcnTr-73fvd)
    
    1:01
    
*   [](https://openai.com/index/introducing-the-codex-app/#:~:text=The%20Codex%20app%20includes%20a%20library%20of%20skills%20for%20tools,with%20professional%20formatting%20and%20layouts.)
    
    Introducing the Codex app - OpenAI
    
    Feb 2, 2026 — The Codex app includes a library of skills for tools and workflows that have become popular at OpenAI, with a few highlighted belo...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcSez-W_4xIfYNsb2C0G-UXrTeD0n5PeO_btS3vd0i3UDS-8yQ5p)
    
*   [](https://shuffle.dev/codex#:~:text=Try%20Visual%20Editor-,Products,WordPress%20AI%20Theme%20Builder)
    
    Visual Editor for Codex - Shuffle
    
    Shuffle's Editors \* Tailwind Editor. \* An online editor for Bootstrap. \* An online editor for Material-UI. ... \* Supporting tools.
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://shuffle.dev&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    shuffle.dev
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsqjCeiUJFp9tc3DQDwUh5e0msu72w8UXL_vZ1lCJ1Yja0DG5g)
    
*   [](https://codesignal.com/learn/courses/introduction-to-codex-1/lessons/expending-codex-with-visual-and-web-context#:~:text=Visual%20context%20helps%20Codex%20act,a%20matching%20React%20component%20layout.)
    
    Expanding Codex with Visual and Web Context
    
    You've seen how it can refactor files, create new ones, and follow your project's rules automatically. Now, it's time to go a step...
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAP1BMVEUQYvsQYvsQYvsQYvsQYvsAXfwJX/yDqv6zy/6St/5qm/1MiP0wd/wDZ/zu9P/6/P/d6f/G2f+jwP52o/0QYvsf4sSCAAAAFXRSTlMdq/r/rv///////////////////7FKCVAdAAAA6klEQVR4AX3S227EIAwEUBqH+2CbZP//W2urQrtqQ+f1gMVYhPB10GOO04y2OcOxxyNsyfKD0ZPIQyl63phLbR3D3GSgt1rywphZLDov4JoqFs5xIXTCTqvUKmpTMBULKRbuwBhTdY4BdC5mC5uwD80i2QeztDcmUr5K6WBGL+VipfRRpUofoDhnJIwuNdIHwt96U2t0+3vxiTSqV2hEzSvZxYVrR10LUdHu+1m4kqwQwMXX+Ae90H2zlXhE6JyK9ISml8gVaYNdpO8wDdWRNkgx50g7TEDaojH9wn3+/5rnHl8hnMfm3it8A12eERq34RBrAAAAAElFTkSuQmCC)
    
    CodeSignal·
    
    ![](https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcRtMCSHqK-VLQ7uMWtegGHWMCbfng6PM3XLC0Yj0F5xTnqosERD)
    
*   [](https://medium.com/@alphadesignglobal/is-framer-the-best-for-creating-visually-stunning-restaurant-or-hospitality-websites-7bb5e73f0a0f)
    
    Framer
    
    The Core Concept: What Makes Framer a Fit for Hospitality? Framer is a visual design tool first, and a website builder second.
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://medium.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Framer
    
*   [](https://medium.com/authority-magazine/ai-and-automation-alex-sandoval-of-allie-systems-on-how-to-effectively-harness-ai-technology-in-00bfecc8507f)
    
    Figma
    
    Figma, a product design tool. I love user-centered design. Figma is a great visual tool that gets people to workshop things and re...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://medium.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Figma
    
*   [](https://www.modelo.io/damf/article/2024/10/09/1228/how-to-insert-objects-into-blender)
    
    Blender
    
    Blender is a powerful 3D modeling software that allows you to create stunning visual designs. One of the key features of Blender i...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://www.modelo.io&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Blender
    
*   [](https://blueskygraphics.co.uk/cut-text-effect-with-adobe-illustrator/)
    
    Adobe Illustrator
    
    Discover graphic design's Adobe Illustrator-fuelled possibilities Adobe Illustrator is a powerful and versatile graphic design too...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://blueskygraphics.co.uk&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Adobe Illustrator
    
*   [](https://peoplemanagingpeople.com/tools/best-ai-strategy-tools/)
    
    Canva
    
    Canva Canva makes visual design easy with smart layout tools. Canva is a graphic design platform used by individuals and businesse...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://peoplemanagingpeople.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Canva
    
*   [](https://blueskygraphics.co.uk/image-inside-text-tutorial-with-adobe-indesign/)
    
    Adobe InDesign
    
    Adobe InDesign is a powerful graphic design tool used by professionals around the world. It's no secret that Adobe InDesign offers...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://blueskygraphics.co.uk&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Adobe InDesign
    
*   [](https://corizo.in/what-are-the-best-ui-ux-designing-tools-for-windows/)
    
    Affinity Designer
    
    6\. Affinity Designer While not solely a UI/UX ( UI/UX design ) tool, Affinity Designer is a robust vector graphic design software ...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://corizo.in&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Affinity Designer
    
*   [](https://www.mockplus.com/blog/post/how-to-become-a-full-stack-developer)
    
    Sketch
    
    Sketch is a well-known design tool that enables designers and developers to visualize their design ideas from scratch. It comes wi...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://www.mockplus.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Sketch
    
*   [](https://www.framer.com/compare/framer-vs-codex)
    
    Framer
    
    Use Codex for momentum, Framer for final control “We love working in Framer. “We thought using Framer with our next. “Framer allow...
    
    ![](https://encrypted-tbn1.gstatic.com/faviconV2?url=https://www.framer.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Framer
    
*   [](https://www.createwith.com/tool/figma/updates/figma-introduces-codex-for-seamless-code-and-canvas-integration)
    
    Figma
    
    Figma Introduces Codex for Seamless Code and Canvas Integration Figma has unveiled its latest feature, Codex, which enables a seam...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://www.createwith.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Figma
    
*   [](https://www.etsy.com/au/listing/1214008573/easter-eggs-color-palette-30-spring)
    
    Canva
    
    Also included is a HEX Code chart to use in Canva, Figma or the Adobe Creative Suite. \*\*\* Please note: The swatches here are for P...
    
    ![](https://encrypted-tbn1.gstatic.com/faviconV2?url=https://www.etsy.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Canva
    
*   [](https://www.threads.com/@smiling.ank.1/post/DWatP0Fl013/open-ai-just-pushed-codex-past-the-editor-by-rolling-out-plugins-that-connect#:~:text=OpenAI%20just%20pushed%20Codex%20past%20the%20editor,code%20instead%20of%20only%20the%20code%20itself.)
    
    OpenAI just pushed Codex past the editor by rolling out plugins that ...
    
    Mar 28, 2026 — OpenAI just pushed Codex past the editor by rolling out plugins that connect it to tools like Slack, Figma, Notion, Gmail, and Goo...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.threads.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Threads
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR_hl5vnByBJfnQG6nJXo-cS-YWAdmqCL1UwsqWzosymmaWiT2H)
    
*   [](https://developers.openai.com/blog/building-frontend-uis-with-codex-and-figma#:~:text=When%20code%20and%20the%20canvas%20are%20connected%2C,high%2Dquality%20application%20experiences%20without%20compromising%20on%20speed.)
    
    Building frontend UIs with Codex and Figma
    
    Feb 26, 2026 — When code and the canvas are connected, you can move fluidly between execution and exploration. This roundtrip process unlocks the...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://developers.openai.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    OpenAI Developers
    
    ![](https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcTZXEs5Du1JXOYsG4NEGVwSAouxuObXWTBV2lDgWd3lOThbhuWK)
    
*   [](https://www.youtube.com/watch?v=P7HXxl14dCA)
    
    How designers prototype using the Codex app and Figma - YouTube
    
    Feb 4, 2026 — Takeaways: One-click install for Figma with the Figma skill. Pasting a Figma link is enough to kick off a strong first pass. Codex...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://www.youtube.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    YouTube
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcSlGc3BTOgIGjSwUnbxl55WtB-YeK01xSFaexPKbNJSSJoOcNuT)
    
*   [](https://www.kinexmedia.com/blog/ux-design-tools/#:~:text=Framer%20has%20both%20creative%20freedom%20like%20Figma,handles%20the%20technical%20aspects%20behind%20the%20scenes.)
    
    Top 10 Free UX Design Tools For Beginners in 2026
    
    Sep 30, 2024 — Framer has both creative freedom like Figma and functionality like Webflow. This means designers can conveniently focus on creatin...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.kinexmedia.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Kinex Media Inc.
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcTzzaNNBkwNSanZU-YVGLXDs2u2Ljxak7sxalwaTA-ug3LP6bgE)
    
*   [](https://www.justinmind.com/web-design/tools#:~:text=With%20Framer%2C%20design%20and%20development%20meet.%20It,ensure%20their%20designs%20are%20functional%20and%20polished.)
    
    Best web design tools: the ultimate guide
    
    Jul 31, 2024 — With Framer, design and development meet. It allows you to create high-fidelity prototypes and even production-ready sites in one ...
    
    ![](https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.justinmind.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Justinmind
    
    ![](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQrFZQk-QcMN2r223r3InHzaNr26kqU4-zxC4NkoewYS6YW4L-V)
    
*   [](https://www.phaedrasolutions.com/blog/best-ui-design-tools#:~:text=5.%20Affinity%20Designer%20%E2%80%93%20Best%20Budget%20Tool,layouts%2C%20and%20visuals%20without%20breaking%20the%20bank.)
    
    Top 20 UI Design Tools Every Modern Designer Needs
    
    Aug 6, 2025 — 5\. Affinity Designer – Best Budget Tool for UI & Vector Work Affinity Designer is a solid, budget-friendly alternative to Adobe Il...
    
    ![](https://encrypted-tbn2.gstatic.com/faviconV2?url=https://www.phaedrasolutions.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Phaedra Solutions
    
    ![](https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcQEkhX7HnrxZBdfcWgqMJgs49o_E5qQuKyhlNyzR7i5qSJ7FnBC)
    
*   [](https://localazy.com/blog/21-must-know-design-tools-and-frameworks-for-unforgettable-digital-products#:~:text=11.%20Affinity%20Designer%20\(Illustrator%20Alternative\)%20%F0%9F%94%97%20Affinity,gradients%2C%20filters%2C%20effects%2C%20and%20robust%20export%20options.)
    
    21 must-know design tools and frameworks for building unforgettable digital products
    
    Feb 22, 2024 — 11\. Affinity Designer (Illustrator Alternative) 🔗 Affinity Designer is a vector graphics-based alternative software to Adobe Illu...
    
    ![](https://encrypted-tbn3.gstatic.com/faviconV2?url=https://localazy.com&client=AIM&size=128&type=FAVICON&fallback_opts=TYPE,SIZE,URL)
    
    Localazy
    
    ![](https://encrypted-tbn1.gstatic.com/images?q=tbn:ANd9GcTEA70zfGqzzDCC9dL3eR3t4WbfLwgoXJlnBNCZKcROLHoQNvU5)
    

References:
===========

*   [undefined](undefined)
*   [undefined](undefined)