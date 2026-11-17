var stream = require("stream");
var needle = require("needle");
var fs = require("fs");
var iconv = require("iconv-lite");
var charsetDetector = require("charset-detector");
var zlib = require("zlib");
var zip = require("zip");
var _ = require("underscore");

function streamFromPath(path, agent)
{
	if (path instanceof stream.Readable) return path;
	if (path.match("^http")) return needle.get(path, { agent: agent, follow_max: 12, parse_response: false, decode_response: false });
	return fs.createReadStream(path);
};

function isUtf8Text(buf)
{
    // UTF-16 ASCII text also round-trips as UTF-8, but contains NUL bytes.
    return buf.indexOf(0) === -1 && iconv.encode(buf.toString("utf8"), "utf8").equals(buf);
}

function charsetFromBom(buf)
{
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return "utf16le";
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return "utf16be";
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return "utf8";
    return null;
}

function charsetFromContentType(contentType)
{
    var match = (contentType || "").match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i);
    if (!match) return null;
    var charset = match[1].toLowerCase();
    if (charset === "iso-8859-8-i") charset = "ISO-8859-8";

    // Generic server defaults are not evidence of the subtitle's encoding.
    var normalized = charset.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/^(?:utf8|unicode11utf8|iso88591|latin1|usascii|ascii)$/.test(normalized)) return null;
    return iconv.encodingExists(charset) ? charset : null;
}

function retrieveSrt(path, cb, options)
{
    var callback = _.once(function(err, res) {
        if (err && options && options.agent) return retrieveSrt(path, cb); // Re-try without agent
        cb(err, res);
    });
    
    var declaredCharset;
    var isZip = path.match("zip$");
    var stream = streamFromPath(path, options && options.agent);
    // Listen before piping gzip responses; ZIP headers describe the archive, not its entries.
    if (!isZip) stream.on("headers", function(headers) {
        declaredCharset = charsetFromContentType(headers["content-type"]);
    });
    stream.on("error", function(err) { callback(err) });
    if (isZip) {
        var foundSrt = false, bufs = [];

        var zipbufs = [];
        stream.on("data", function(b) { zipbufs.push(b) });
        stream.on("end", function() {
            try {
                zip.Reader(Buffer.concat(zipbufs)).forEach(onEntry);
            } catch(e) { return callback(e) }

            function onEntry(entry) {
                if (!entry.getName().match("srt$") || foundSrt) return;
                foundSrt = true;
                bufs.push(entry.getData());
            }
            
            if (!foundSrt) return callback(new Error("no srt found in zip file "+path));
            onDownloaded();
        });
    } else {
        if (path.match("gz$")) var stream = stream.pipe(zlib.createUnzip());
        var bufs = [];
        stream.on("data", function(dat) { bufs.push(dat) })
        stream.on("end", onDownloaded);
        stream.on("error", function(e) { callback(e) });                
    }

    function onDownloaded() {
        //if (! bufs.length) HANDLE ERROR

        var buf = Buffer.concat(bufs);

        var charset;
        try {
               var bomCharset = charsetFromBom(buf);
               if (options && options.charset && options.charset != "auto") charset = options.charset;
               else if (bomCharset) charset = bomCharset;
               else if (isUtf8Text(buf)) charset = "utf8";
               else if (declaredCharset) charset = declaredCharset;
               else charset = charsetDetector(buf)[0].charsetName;

               // handles a special case where ISO-8859-8 IANA is detected
               // which iconv-lite does not support directly:
               charset = charset == 'ISO-8859-8-I' ? 'ISO-8859-8' : charset

               buf = iconv.decode(buf, charset) 
        } catch(e) { callback(e); return };

        callback(null, buf);           
    };    
};

module.exports = {
	streamFromPath: streamFromPath,
	retrieveSrt: retrieveSrt,
};
