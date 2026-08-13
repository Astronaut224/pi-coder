[Skip to main content](https://www.electronjs.org/docs/latest/api/web-utils#__docusaurus_skipToContent_fallback)

[![Electron homepage](https://www.electronjs.org/assets/img/logo.svg)\\
**Electron**](https://www.electronjs.org/) [Docs](https://www.electronjs.org/docs/latest/) [API](https://www.electronjs.org/docs/latest/api/app) [Blog](https://www.electronjs.org/blog)

[Tools](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Electron Forge](https://electronforge.io/)
- [Electron Fiddle](https://www.electronjs.org/fiddle)

[Community](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Governance](https://www.electronjs.org/governance)
- [Showcase](https://www.electronjs.org/apps)
- [Resources](https://www.electronjs.org/community)

[Releases](https://releases.electronjs.org/)

[English](https://www.electronjs.org/docs/latest/api/web-utils#)

- [English](https://www.electronjs.org/docs/latest/api/web-utils)
- [Deutsch](https://www.electronjs.org/de/docs/latest/api/web-utils)
- [Español](https://www.electronjs.org/es/docs/latest/api/web-utils)
- [Français](https://www.electronjs.org/fr/docs/latest/api/web-utils)
- [日本語](https://www.electronjs.org/ja/docs/latest/api/web-utils)
- [Português](https://www.electronjs.org/pt/docs/latest/api/web-utils)
- [Русский](https://www.electronjs.org/ru/docs/latest/api/web-utils)
- [中文](https://www.electronjs.org/zh/docs/latest/api/web-utils)

[GitHub repository](https://github.com/electron/electron)

Search`Ctrl`  `K`

- [Main Process Modules](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Renderer Process Modules](https://www.electronjs.org/docs/latest/api/web-utils#)

  - [clipboard](https://www.electronjs.org/docs/latest/api/clipboard)
  - [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
  - [crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter)
  - [ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)
  - [nativeImage](https://www.electronjs.org/docs/latest/api/native-image)
  - [webFrame](https://www.electronjs.org/docs/latest/api/web-frame)
  - [webUtils](https://www.electronjs.org/docs/latest/api/web-utils)
- [Utility Process Modules](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Custom DOM Elements](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Chromium and Node.js](https://www.electronjs.org/docs/latest/api/web-utils#)

- [Classes](https://www.electronjs.org/docs/latest/api/web-utils#)

- [API Structures](https://www.electronjs.org/docs/latest/api/web-utils#)


- [Home page](https://www.electronjs.org/)
- Renderer Process Modules
- webUtils

On this page

# webUtils

> A utility layer to interact with Web API objects (Files, Blobs, etc.)

Process: [Renderer](https://www.electronjs.org/docs/latest/glossary#renderer-process)

info

If you want to call this API from a renderer process with context isolation enabled,
place the API call in your preload script and
[expose](https://www.electronjs.org/docs/latest/tutorial/context-isolation#after-context-isolation-enabled) it using the
[`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge) API.

## Methods [​](https://www.electronjs.org/docs/latest/api/web-utils\#methods "Direct link to Methods")

The `webUtils` module has the following methods:

### `webUtils.getPathForFile(file)` [​](https://www.electronjs.org/docs/latest/api/web-utils\#webutilsgetpathforfilefile "Direct link to webutilsgetpathforfilefile")

- `file` File - A web [File](https://developer.mozilla.org/en-US/docs/Web/API/File) object.

Returns `string` \- The file system path that this `File` object points to. In the case where the object passed in is not a `File` object an exception is thrown. In the case where the File object passed in was constructed in JS and is not backed by a file on disk an empty string is returned.

This method superseded the previous augmentation to the `File` object with the `path` property. An example is included below.

```js
// Before (renderer)

const oldPath = document.querySelector('input[type=file]').files[0].path
```

```js
// After

// Renderer:

const file = document.querySelector('input[type=file]').files[0]

electronApi.doSomethingWithFile(file)

// Preload script:

const { contextBridge, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronApi', {

  doSomethingWithFile (file) {

    const path = webUtils.getPathForFile(file)

    // Do something with the path, e.g., send it over IPC to the main process.

    // It's best not to expose the full file path to the web content if possible.

  }

})
```

[Edit this page](https://github.com/electron/electron/edit/main/docs/api/web-utils.md)

[Previous\\
\\
webFrame](https://www.electronjs.org/docs/latest/api/web-frame) [Next\\
\\
net](https://www.electronjs.org/docs/latest/api/net)

- [Methods](https://www.electronjs.org/docs/latest/api/web-utils#methods)
  - [`getPathForFile`](https://www.electronjs.org/docs/latest/api/web-utils#webutilsgetpathforfilefile)

Docs

- [Getting Started](https://www.electronjs.org/docs/latest/)
- [API Reference](https://www.electronjs.org/docs/latest/api/app)

Checklists

- [Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Security](https://www.electronjs.org/docs/latest/tutorial/security)

Tools

- [Electron Forge](https://electronforge.io/)
- [Electron Fiddle](https://www.electronjs.org/fiddle)

Community

- [Governance](https://www.electronjs.org/governance)
- [Resources](https://www.electronjs.org/community)
- [Discord](https://discordapp.com/invite/APGC3k5yaH)
- [Bluesky](https://bsky.app/profile/electronjs.org)
- [X](https://x.com/electronjs)
- [Mastodon](https://social.lfx.dev/@electronjs)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/electron)

More

- [GitHub](https://github.com/electron/electron)
- [Open Collective](https://opencollective.com/electron)
- [Infrastructure Dashboard](https://p.datadoghq.com/sb/c44e1df0-85d7-11ee-94c9-da7ad0900002-c245f7ef47d0d0c32abecdc0938c2a85)

[![OpenJS Foundation Logo](https://www.electronjs.org/assets/img/openjsf_logo.svg)](https://openjsf.org/)

Copyright [OpenJS Foundation](https://openjsf.org/) and Electron contributors. All rights reserved. The [OpenJS Foundation](https://openjsf.org/) has registered trademarks and uses trademarks. For a list of trademarks of the [OpenJS Foundation](https://openjsf.org/), please see our [Trademark Policy](https://trademark-policy.openjsf.org/) and [Trademark List](https://trademark-list.openjsf.org/). Trademarks and logos not indicated on the [list of OpenJS Foundation trademarks](https://trademark-list.openjsf.org/) are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.

[The OpenJS Foundation](https://openjsf.org/) \| [Terms of Use](https://terms-of-use.openjsf.org/) \| [Privacy Policy](https://privacy-policy.openjsf.org/) \| [Bylaws](https://bylaws.openjsf.org/) \| [Code of Conduct](https://code-of-conduct.openjsf.org/) \| [Trademark Policy](https://trademark-policy.openjsf.org/) \| [Trademark List](https://trademark-list.openjsf.org/) \| [Cookie Policy](https://www.linuxfoundation.org/cookies)

Hosting and infrastructure graciously provided by

![Azure Logo](https://www.electronjs.org/assets/third-parties/azure.png)![Heroku Logo](https://www.electronjs.org/assets/third-parties/heroku_dark.png)![Heroku Logo](https://www.electronjs.org/assets/third-parties/heroku_light.png)![DataDog Logo](https://www.electronjs.org/assets/third-parties/datadog_dark.png)![DataDog Logo](https://www.electronjs.org/assets/third-parties/datadog_light.png)