import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync('dist/package.json', `${JSON.stringify(pkg, null, 4)}\n`);

for (const file of ['README.md', 'CHANGELOG.md']) {
    copyFileSync(file, `dist/${file}`);
}
