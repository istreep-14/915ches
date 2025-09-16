// Utility functions for settings, sheets, headers, and dates

var U = (function() {
	function getSpreadsheet() {
		return SpreadsheetApp.getActive();
	}

	function getOrCreateSheet(name) {
		var ss = getSpreadsheet();
		var sh = ss.getSheetByName(name);
		if (!sh) sh = ss.insertSheet(name);
		return sh;
	}

	function ensureHeaders(sheet, headers) {
		var range = sheet.getRange(1, 1, 1, headers.length);
		range.setValues([headers]);
		sheet.setFrozenRows(1);
	}

	function getHeaderIndexMap(sheet) {
		var lastCol = sheet.getLastColumn();
		if (lastCol === 0) return {};
		var values = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
		var map = {};
		for (var i = 0; i < values.length; i++) map[String(values[i])] = i + 1;
		return map;
	}

	function readSettings() {
		var sh = getOrCreateSheet(CONST.SHEET.SETTINGS);
		var last = sh.getLastRow();
		var kv = {};
		if (last >= 2) {
			var rows = sh.getRange(2, 1, last - 1, 2).getValues();
			for (var i = 0; i < rows.length; i++) {
				var k = String(rows[i][0] || '').trim();
				if (!k) continue;
				kv[k] = String(rows[i][1] || '').trim();
			}
		}
		// apply defaults
		for (var key in CONST.SETTINGS_DEFAULTS) {
			if (!(key in kv)) kv[key] = CONST.SETTINGS_DEFAULTS[key];
		}
		return kv;
	}

	function toSheetDate(epochSeconds) {
		if (!epochSeconds && epochSeconds !== 0) return '';
		var ms = Number(epochSeconds) * 1000;
		return new Date(ms);
	}

	function now() {
		return new Date();
	}

	function setKeyValueSettings(pairs) {
		var sh = getOrCreateSheet(CONST.SHEET.SETTINGS);
		ensureHeaders(sh, ['key', 'value']);
		var existing = {};
		var last = sh.getLastRow();
		if (last >= 2) {
			var rows = sh.getRange(2, 1, last - 1, 2).getValues();
			for (var i = 0; i < rows.length; i++) {
				existing[String(rows[i][0])] = i + 2;
			}
		}
		var writes = [];
		for (var k in pairs) {
			if (existing[k]) {
				sh.getRange(existing[k], 2).setValue(pairs[k]);
			} else {
				writes.push([k, pairs[k]]);
			}
		}
		if (writes.length) sh.getRange(sh.getLastRow() + 1, 1, writes.length, 2).setValues(writes);
	}

	function getScriptProp(key) {
		try {
			return PropertiesService.getScriptProperties().getProperty(String(key));
		} catch (e) {
			return null;
		}
	}

	function setScriptProp(key, value) {
		try {
			PropertiesService.getScriptProperties().setProperty(String(key), String(value));
		} catch (e) {
			// ignore
		}
	}

	return {
		getSpreadsheet: getSpreadsheet,
		getOrCreateSheet: getOrCreateSheet,
		ensureHeaders: ensureHeaders,
		getHeaderIndexMap: getHeaderIndexMap,
		readSettings: readSettings,
		toSheetDate: toSheetDate,
		now: now,
		setKeyValueSettings: setKeyValueSettings,
		getScriptProp: getScriptProp,
		setScriptProp: setScriptProp
	};
})();