const fs = require('fs/promises')
const path = require('path')
const child_process = require('child_process')

async function run() {
    await fs.rm(path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
    child_process.execSync('npm run tsbuild && npx neu build --release')
    await fs.rm(path.join(__dirname, './dist/nova-vn/resources.neu'))
    await fs.cp(path.join(__dirname, './docs'), path.join(__dirname, './dist/nova-vn'), { recursive: true, force: true })
    await fs.cp(path.join(__dirname, './project'), path.join(__dirname, './dist/nova-vn/project'), { recursive: true, force: true })
}

run()
