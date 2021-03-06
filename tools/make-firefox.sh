#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** FindxPrivacyControl.FF: Copying files"

DES=dist/build/privacycontrol@findx.com
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R src/css                           $DES/
cp -R src/img                           $DES/
cp -R src/js                            $DES/
cp -R src/lib                           $DES/
cp -R src/_locales                      $DES/
cp    src/*.html                        $DES/

mv    $DES/img/icon_128.png             $DES/icon.png
cp    platform/firefox/css/*            $DES/css/
cp    platform/firefox/polyfill.js      $DES/js/
cp    platform/firefox/vapi-*.js        $DES/js/
cp    platform/chromium/vapi-usercss.real.js $DES/js/
cp    platform/firefox/bootstrap.js     $DES/
cp    platform/firefox/processScript.js $DES/
cp    platform/firefox/frame*.js        $DES/
cp -R platform/firefox/img              $DES/
cp    platform/firefox/chrome.manifest  $DES/
cp    platform/firefox/install.rdf      $DES/
cp    platform/firefox/*.xul            $DES/
cp    LICENSE.txt                       $DES/

echo "*** FindxPrivacyControl.FF: concatenating content scripts"
cat $DES/js/vapi-usercss.real.js > /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/contentscript.js >> /tmp/contentscript.js
mv /tmp/contentscript.js $DES/js/contentscript.js
rm $DES/js/vapi-usercss.real.js

echo "*** FindxPrivacyControl.FF: Generating meta..."
python tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    set +v
    echo "*** FindxPrivacyControl.FF: Creating package..."
    pushd $DES/ > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** FindxPrivacyControl.FF: Package done."
