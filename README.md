# Deploy

```
rm -rf dist && npm run build && npm run package && npm run deploy

rm -rf dist && tsc && rm -rf dist/node_modules && npm publish --access public

rm -rf dist && tsc && rm -rf dist/node_modules && 'cp' -rf dist/ /e/Source/zerotoheroes/firestone/core/node_modules/\@firestone-hs/trigger-process-mercenaries-review/

```

# Reference

Used this project as template: https://github.com/alukach/aws-sam-typescript-boilerplate
