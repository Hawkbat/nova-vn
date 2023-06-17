const fs = require('fs/promises')
const path = require('path')
const child_process = require('child_process')
const GetGoogleFonts = require('get-google-fonts')

async function run() {
    await fs.rm(path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
    await new GetGoogleFonts().download(`https://fonts.googleapis.com/css2?family=Lato`, {
        outputDir: './docs/engine/fonts',
    })
    await fs.cp(path.join(__dirname, './node_modules/monaco-editor/min/vs'), path.join(__dirname, './docs/engine/monaco-editor'), { recursive: true, force: true })
    child_process.execSync('npm run tsbuild && npx neu build --release')
    await fs.rm(path.join(__dirname, './dist/nova-vn/resources.neu'))
    await fs.cp(path.join(__dirname, './docs'), path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
}

run()
