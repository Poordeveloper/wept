watch:
	@gulp

publish:
	@gulp prepublish
	#@publish
	@uglifyjs public/script/build.js > x; mv x public/script/build.js

update:
	@cp /Users/chemzqm/Library/Application\ Support/微信web开发者工具/WeappVendor/* ./.official
	@cp /Applications/wechatwebdevtools.app/Contents/Resources/app.nw/app/dist/inject/jweixindebug.js ./.official
	@cp /Applications/wechatwebdevtools.app/Contents/Resources/app.nw/app/dist/weapp/appservice/asdebug.js ./.official

.PHONY: watch
