const fs = require('fs/promises')
const path = require('path')
const child_process = require('child_process')
const GetGoogleFonts = require('get-google-fonts')

async function run() {
    // Clear out existing dist folder
    await fs.rm(path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
    
    // Download Google Fonts and save to source folder
    await new GetGoogleFonts().download(`https://fonts.googleapis.com/css2?family=Lato`, {
        outputDir: './docs/engine/fonts',
    })

    // Copy Monaco Editor from node modules to source folder
    await fs.cp(path.join(__dirname, './node_modules/monaco-editor/min/vs'), path.join(__dirname, './docs/engine/monaco-editor'), { recursive: true, force: false, errorOnExist: false })

    // Run TypeScript transpiler in source folder
    child_process.execSync('npm run tsbuild')
    
    // Run Neutralinojs build
    child_process.execSync('npx neu build --release')

    // Delete Neutralinojs resource bundle from destination folder, to force it to stream from disk instead
    await fs.rm(path.join(__dirname, './dist/nova-vn/resources.neu'))

    // Copy source folder to destination folder
    await fs.cp(path.join(__dirname, './docs'), path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
}

run()
