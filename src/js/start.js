/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global publicSuffixList */

'use strict';

/******************************************************************************/

// Load all: executed once.

µBlock.restart = (function() {

//quickProfiler.start('start.js');

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

vAPI.app.onShutdown = function() {
    µb.staticFilteringReverseLookup.shutdown();
    µb.assets.updateStop();
    µb.staticNetFilteringEngine.reset();
    µb.cosmeticFilteringEngine.reset();
    µb.sessionFirewall.reset();
    µb.permanentFirewall.reset();
    µb.permanentFirewall.reset();
    µb.sessionURLFiltering.reset();
    µb.permanentURLFiltering.reset();
};

/******************************************************************************/

var processCallbackQueue = function(queue, callback) {
    var processOne = function() {
        var fn = queue.pop();
        if ( fn ) {
            fn(processOne);
        } else if ( typeof callback === 'function' ) {
            callback();
        }
    };
    processOne();
};

/******************************************************************************/

// Final initialization steps after all needed assets are in memory.
// - Initialize internal state with maybe already existing tabs.
// - Schedule next update operation.

var onAllReady = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/184
    // Check for updates not too far in the future.
    µb.assets.addObserver(µb.assetObserver.bind(µb));
    µb.scheduleAssetUpdater(µb.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);

    // vAPI.cloud is optional.
    if ( µb.cloudStorageSupported ) {
        vAPI.cloud.start([
            'tpFiltersPane',
            'myFiltersPane',
            'myRulesPane',
            'whitelistPane'
        ]);
    }

    //quickProfiler.stop(0);

    //µb.contextMenu.update(null);
    µb.firstInstall = false;

    processCallbackQueue(µb.onStartCompletedQueue);
};

/******************************************************************************/

// Filtering engines dependencies:
// - PSL

var onPSLReady = function() {
    µb.loadFilterLists(onAllReady);
};

/******************************************************************************/

// To bring older versions up to date

var onVersionReady = function(lastVersion) {
    // Starting with 1.9.17, non-advanced users can have access to the dynamic
    // filtering pane in read-only mode. Still, it should not be visible by
    // default.
    if ( lastVersion.localeCompare('1.9.17') < 0 ) {
        if (
            µb.userSettings.advancedUserEnabled === false &&
            µb.userSettings.dynamicFilteringEnabled === true
        ) {
            µb.userSettings.dynamicFilteringEnabled = false;
            µb.keyvalSetOne('dynamicFilteringEnabled', false);
        }
    }
    if ( lastVersion !== vAPI.app.version ) {
        vAPI.storage.set({ version: vAPI.app.version });
    }
};

/******************************************************************************/

var onSelfieReady = function(selfie) {
    if ( selfie === null || selfie.magic !== µb.systemSettings.selfieMagic ) {
        return false;
    }
    if ( publicSuffixList.fromSelfie(selfie.publicSuffixList) !== true ) {
        return false;
    }
    if ( selfie.redirectEngine === undefined ) {
        return false;
    }

    µb.availableFilterLists = selfie.availableFilterLists;
    µb.staticNetFilteringEngine.fromSelfie(selfie.staticNetFilteringEngine);
    µb.redirectEngine.fromSelfie(selfie.redirectEngine);
    µb.cosmeticFilteringEngine.fromSelfie(selfie.cosmeticFilteringEngine);
    return true;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/226
// Whitelist in memory.
// Whitelist parser needs PSL to be ready.
// gorhill 2014-12-15: not anymore

var onNetWhitelistReady = function(netWhitelistRaw) {
    µb.netWhitelist = µb.whitelistFromString(netWhitelistRaw);
    µb.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

// User settings are in memory

var onUserSettingsReady = function(fetched) {
    var userSettings = µb.userSettings;

    fromFetch(userSettings, fetched);

    if ( µb.privacySettingsSupported ) {
        vAPI.browserSettings.set({
            'hyperlinkAuditing': !userSettings.hyperlinkAuditingDisabled,
            'prefetching': !userSettings.prefetchingDisabled,
            'webrtcIPAddress': !userSettings.webrtcIPAddressHidden
        });
    }

    µb.permanentFirewall.fromString(fetched.dynamicFilteringString);
    µb.sessionFirewall.assign(µb.permanentFirewall);
    µb.permanentURLFiltering.fromString(fetched.urlFilteringString);
    µb.sessionURLFiltering.assign(µb.permanentURLFiltering);
    µb.hnSwitches.fromString(fetched.hostnameSwitchesString);

    // https://github.com/gorhill/uBlock/issues/1892
    // For first installation on a battery-powered device, disable generic
    // cosmetic filtering.
    if ( µb.firstInstall && vAPI.battery ) {
        userSettings.ignoreGenericCosmeticFilters = true;
    }
};

/******************************************************************************/

// Housekeeping, as per system setting changes

var onSystemSettingsReady = function(fetched) {
    var mustSaveSystemSettings = false;
    if ( fetched.compiledMagic !== µb.systemSettings.compiledMagic ) {
        µb.assets.remove(/^compiled\//);
        mustSaveSystemSettings = true;
    }
    if ( fetched.selfieMagic !== µb.systemSettings.selfieMagic ) {
        mustSaveSystemSettings = true;
    }
    if ( mustSaveSystemSettings ) {
        fetched.selfie = null;
        µb.selfieManager.destroy();
        vAPI.storage.set(µb.systemSettings, µb.noopFunc);
    }
};

/******************************************************************************/

    /**
     * In a version 1.7.5.4 we start loading filters from a privacontrol server.
     * So we need to clear all earlier filters from the storage, because if we don't clear it -
     *      previous filters from ublock server will  be displayed too.
 *      We must clear it only once, so we set "isFiltersErased" item to a storage.
     */
    var checkFiltersListsSources = function (callback) {
        try {
            // In a 1.11.3.0 we change links to filters so we need to purge all cached data for loading filters from new links
            if (compareVersions(vAPI.app.version, "1.11.3.0") >= 0) {
                vAPI.storage.get('isCacheErased_1.11.3.0', function (data) {
                    if (!data || !Object.keys(data).length || !data["isCacheErased_1.11.3.0"]) {
                        µb.assets.remove(/./);
                        //vAPI.storage.set({ 'availableFilterLists': {} }, null);
                        vAPI.cacheStorage.clear();
                        vAPI.storage.clear();
                        vAPI.localStorage.removeItem('hiddenSettings');

                        // Keep global counts, people can become quite attached to numbers
                        µb.saveLocalSettings();
                        vAPI.storage.set({ 'isCacheErased_1.11.3.0': true });

                        vAPI.app.restart();
                    }
                    if (callback) callback();
                });
            }

            if (callback) callback();
        }
        catch (exception) {
            console.error("Exception in 'checkFiltersListsSources' (start.js) :\n\t", exception);
            if (callback) callback();
        }
    };

    var compareVersions = function (version, compared) {
        var response = 0;

        if (version != compared) {
            var comparedNums = compared.split(".");
            var versionNums = version.split(".");
            for (var i = 0; i < versionNums.length; i++) {
                var num = parseInt(versionNums[i]);
                if (typeof comparedNums[i] != "undefined") {
                    if (num > parseInt(comparedNums[i])) {
                        response = 1;
                        break;
                    }
                    else if (num < parseInt(comparedNums[i])) {
                        response = -1;
                        break;
                    }
                }
            }
        }

        return response;
    };

/******************************************************************************/

var onFirstFetchReady = function(fetched) {
    // https://github.com/gorhill/uBlock/issues/747
    µb.firstInstall = fetched.version === '0.0.0.0';

    checkFiltersListsSources(function () {
        // Order is important -- do not change:
        onSystemSettingsReady(fetched);
        fromFetch(µb.localSettings, fetched);
        onUserSettingsReady(fetched);
        fromFetch(µb.restoreBackupSettings, fetched);
        onNetWhitelistReady(fetched.netWhitelist);
        onVersionReady(fetched.version);

        // If we have a selfie, skip loading PSL, filters
        if ( onSelfieReady(fetched.selfie) ) {
            onAllReady();
            return;
        }

        µb.loadPublicSuffixList(onPSLReady);
    });
};

/******************************************************************************/

var toFetch = function(from, fetched) {
    for ( var k in from ) {
        if ( from.hasOwnProperty(k) === false ) {
            continue;
        }
        fetched[k] = from[k];
    }
};

var fromFetch = function(to, fetched) {
    for ( var k in to ) {
        if ( to.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( fetched.hasOwnProperty(k) === false ) {
            continue;
        }
        to[k] = fetched[k];
    }
};

/******************************************************************************/

var onSelectedFilterListsLoaded = function() {
    var fetchableProps = {
        'compiledMagic': '',
        'dynamicFilteringString': 'behind-the-scene * 3p noop\nbehind-the-scene * 3p-frame noop',
        'urlFilteringString': '',
        'hostnameSwitchesString': '',
        'lastRestoreFile': '',
        'lastRestoreTime': 0,
        'lastBackupFile': '',
        'lastBackupTime': 0,
        'netWhitelist': µb.netWhitelistDefault,
        'selfie': null,
        'selfieMagic': '',
        'version': '0.0.0.0'
    };

    toFetch(µb.localSettings, fetchableProps);
    toFetch(µb.userSettings, fetchableProps);
    toFetch(µb.restoreBackupSettings, fetchableProps);

    vAPI.storage.get(fetchableProps, onFirstFetchReady);
};

/******************************************************************************/

// TODO(seamless migration):
// Eventually selected filter list keys will be loaded as a fetchable
// property. Until then we need to handle backward and forward
// compatibility, this means a special asynchronous call to load selected
// filter lists.

var onAdminSettingsRestored = function() {
    µb.loadSelectedFilterLists(onSelectedFilterListsLoaded);
};

/******************************************************************************/

return function() {
    processCallbackQueue(µb.onBeforeStartQueue, function() {
        // https://github.com/gorhill/uBlock/issues/531
        µb.restoreAdminSettings(onAdminSettingsRestored);
    });
};

/******************************************************************************/

})();

/******************************************************************************/

µBlock.restart();
