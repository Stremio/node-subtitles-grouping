var assert = require("chai").assert;
var http = require("http");
var fs = require("fs");
var path = require("path");
var iconv = require("iconv-lite");
var zlib = require("zlib");
var retrieve = require("../lib/retriever").retrieveSrt;

describe("retriever HTTP encoding", function() {
	var subtitle = "1\n00:00:01,000 --> 00:00:05,000\nČ Ć Đ Š Ž é è ï à\n\n";
	var latinSubtitle = "1\n00:00:01,000 --> 00:00:05,000\nC'était déjà l'été. François était très fatigué, mais heureux d'être arrivé à la maison.\n\n";
	var croatianSubtitle = "1\n00:00:01,000 --> 00:00:03,000\nČovjek je došao kući.\n\n";
	var lithuanianSubtitle = "1\n00:00:01,000 --> 00:00:04,000\nŠiandien ąžuolynėje žaidė šuo, o mūsų vaikai čiuožė ant ledo.\n\n";
	var mostlyEnglishSubtitle = "1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n00:00:05,000 --> 00:00:07,000\nWe met at the café near the station.\n\n3\n00:00:08,000 --> 00:00:09,000\nIt’s fine, really. Let us go home now and rest for a while.\n";
	var longerCroatianSubtitle = "1\n00:00:01,000 --> 00:00:10,000\nČovjek je došao kući. Želio je čuti što se dogodilo u našem gradu. Djevojčica je čitala priču, a dječak je tražio svoju školsku torbu. Na ulici su djeca razgovarala o novom učitelju i jučerašnjoj utakmici.\n\n";
	var cases = [
		{
			name: "preserves UTF-8 without a BOM when text/plain has no charset",
			contentType: "text/plain",
			body: iconv.encode(subtitle, "utf8"),
			expected: subtitle
		},
		{
			name: "preserves UTF-8 with an explicit charset",
			contentType: "text/plain; charset=utf-8",
			body: iconv.encode(subtitle, "utf8"),
			expected: subtitle
		},
		{
			name: "decodes Latin-1 subtitles",
			contentType: "text/plain; charset=iso-8859-1",
			body: iconv.encode(latinSubtitle, "latin1"),
			expected: latinSubtitle
		},
		{
			name: "decodes UTF-16LE subtitles with a BOM",
			contentType: "application/x-subrip",
			body: iconv.encode("\ufeff" + subtitle, "utf16le"),
			expected: subtitle
		},
		{
			name: "uses a declared windows-1250 charset for short Croatian subtitles",
			contentType: "text/plain; charset=windows-1250",
			body: iconv.encode(croatianSubtitle, "windows-1250"),
			expected: croatianSubtitle
		},
		{
			name: "uses a quoted, case-insensitive windows-1257 charset",
			contentType: 'text/plain; CHARSET = "WINDOWS-1257"; format=flowed',
			body: iconv.encode(lithuanianSubtitle, "windows-1257"),
			expected: lithuanianSubtitle
		},
		{
			name: "preserves mostly English UTF-8 with only two non-ASCII characters",
			contentType: "text/plain; charset=utf-8",
			body: iconv.encode(mostlyEnglishSubtitle, "utf8"),
			expected: mostlyEnglishSubtitle
		},
		{
			name: "preserves mostly English UTF-8 without a charset",
			contentType: "text/plain",
			body: iconv.encode(mostlyEnglishSubtitle, "utf8"),
			expected: mostlyEnglishSubtitle
		},
		{
			name: "prefers valid UTF-8 over a misleading legacy charset",
			contentType: "text/plain; charset=windows-1250",
			body: iconv.encode(subtitle, "utf8"),
			expected: subtitle
		},
		{
			name: "uses the explicit charset option before UTF-8 validation and headers",
			contentType: "text/plain; charset=windows-1257",
			body: iconv.encode(subtitle, "utf8"),
			options: { charset: "windows-1252" },
			expected: iconv.decode(iconv.encode(subtitle, "utf8"), "windows-1252")
		},
		{
			name: "allows the auto option to use a declared charset",
			contentType: "text/plain; charset=windows-1250",
			body: iconv.encode(croatianSubtitle, "windows-1250"),
			options: { charset: "auto" },
			expected: croatianSubtitle
		},
		{
			name: "retains the declared charset when decompressing a gzip subtitle",
			contentType: "text/plain; charset=windows-1257",
			body: zlib.gzipSync(iconv.encode(lithuanianSubtitle, "windows-1257")),
			extension: ".gz",
			expected: lithuanianSubtitle
		},
		{
			name: "ignores the archive charset for a ZIP entry",
			contentType: "application/zip; charset=windows-1250",
			body: fs.readFileSync(path.join(__dirname, "fixtures", "latin1.srt.zip")),
			extension: ".zip",
			expected: latinSubtitle
		},
		{
			name: "honors a supported legacy label even when detection would disagree",
			contentType: "text/plain; charset=windows-1250",
			body: iconv.encode(latinSubtitle, "latin1"),
			expected: iconv.decode(iconv.encode(latinSubtitle, "latin1"), "windows-1250")
		},
		{
			name: "does not mistake labelled UTF-16LE ASCII bytes for UTF-8",
			contentType: "text/plain; charset=utf-16le",
			body: iconv.encode("1\n00:00:01,000 --> 00:00:03,000\nHello.\n\n", "utf16le"),
			expected: "1\n00:00:01,000 --> 00:00:03,000\nHello.\n\n"
		},
		{
			name: "uses the final response charset after a redirect",
			contentType: "text/plain; charset=windows-1257",
			body: iconv.encode(lithuanianSubtitle, "windows-1257"),
			redirect: true,
			expected: lithuanianSubtitle
		},
		{
			name: "lets an explicit charset override a BOM",
			contentType: "text/plain; charset=windows-1257",
			body: iconv.encode("\ufeff" + subtitle, "utf16le"),
			options: { charset: "windows-1252" },
			expected: iconv.decode(iconv.encode("\ufeff" + subtitle, "utf16le"), "windows-1252")
		}
	];
	["utf16le", "utf16be", "utf8"].forEach(function(encoding) {
		cases.push({
			name: "prefers a " + encoding + " BOM over a wrong legacy header",
			contentType: "text/plain; charset=windows-1250",
			body: iconv.encode("\ufeff" + subtitle, encoding),
			expected: subtitle
		});
	});
	["utf16le", "utf16be"].forEach(function(encoding) {
		cases.push({
			name: "detects unlabelled " + encoding + " without a BOM",
			contentType: "text/plain",
			body: iconv.encode(subtitle, encoding),
			expected: subtitle
		});
	});
	["iso-8859-1", "latin1", "us-ascii", "ascii", "ISO_8859_1", "latin-1"].forEach(function(label) {
		cases.push({
			name: "detects Croatian despite a generic " + label + " label",
			contentType: "text/plain; charset=" + label,
			body: iconv.encode(longerCroatianSubtitle, "windows-1250"),
			expected: longerCroatianSubtitle
		});
	});
	[
		["euc-kr", "오늘은 날씨가 좋습니다."],
		["shift_jis", "今日はいい天気です。"],
		["windows-874", "วันนี้อากาศดีมาก"],
		["iso-8859-16", "Țara noastră are păduri și râuri."],
		["ISO-8859-8-I", "שלום עולם"]
	].forEach(function(legacy) {
		var text = "1\n00:00:01,000 --> 00:00:03,000\n" + legacy[1] + "\n\n";
		cases.push({
			name: "decodes a short subtitle labelled " + legacy[0],
			contentType: "text/plain; charset=" + legacy[0],
			body: iconv.encode(text, legacy[0] === "ISO-8859-8-I" ? "ISO-8859-8" : legacy[0]),
			expected: text
		});
	});
	["text/plain", "text/plain; charset=unknown-charset", "text/plain; charset=UTF-8"].forEach(function(contentType) {
		cases.push({
			name: "falls back to detection for legacy bytes served as " + contentType,
			contentType: contentType,
			body: iconv.encode(latinSubtitle, "latin1"),
			expected: latinSubtitle
		});
	});
	var server;

	before(function(done) {
		server = http.createServer(function(req, res) {
			var fixture = cases[parseInt(req.url.slice(1), 10)];
			if (fixture.redirect && req.url.indexOf("?final") === -1) {
				res.writeHead(302, { "Location": req.url + "?final", "Content-Type": "text/html; charset=iso-8859-1" });
				return res.end();
			}
			res.setHeader("Content-Type", fixture.contentType);
			res.end(fixture.body);
		});
		server.once("error", done);
		server.listen(0, "127.0.0.1", done);
	});

	after(function(done) {
		server.close(done);
	});

	cases.forEach(function(fixture, index) {
		it(fixture.name, function(done) {
			var url = "http://127.0.0.1:" + server.address().port + "/" + index + (fixture.extension || ".srt");
			retrieve(url, function(err, text) {
				if (err) return done(err);
				assert.strictEqual(text, fixture.expected);
				done();
			}, fixture.options);
		});
	});
});
