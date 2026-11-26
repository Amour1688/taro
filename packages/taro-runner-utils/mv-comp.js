const path = require('node:path')
const { fs } = require('@tarojs/helper')

const srcDir = path.resolve(__dirname, 'src/template')
const distDir = path.resolve(__dirname, 'dist/template')

fs.ensureDirSync(distDir)

for (const name of ['comp', 'comp-new-blended', 'custom-wrapper']) {
  fs.copyFileSync(
    path.join(srcDir, `${name}.ts`),
    path.join(distDir, `${name}.js`)
  )
}
