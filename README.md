# Nova VN

Nova VN is a browser-based engine for visual-novel-style experiences.

## Developer Notes

The code for this project primarily lives in the inaccurately-named `docs` folder, in order to take advantage of the GitHub Pages feature that allows for publishing static sites from the `docs` folder of a repository.

The engine is designed to be used either as static files served by a traditional website, such as GitHub Pages or another web host, or it can be downloaded and executed as a native app, powered by the [Neutralinojs framework](https://neutralino.js.org/).

The app is not currently designed to work offline, even as a standalone executable, as it relies on loading Google Fonts and the Monaco Code Editor from CDNs. This could be solved in the future by bundling these files with the application insteed.