import {parseChunk, makeError, makeWarn} from './chunk_parser.js';
import {parseMacBinary, extractDataFork} from './mac_binary.js';

export function parseMidiFile(buf, options = {}, logs = []) {
	console.assert(buf instanceof Uint8Array);
	options = options || {};

	// Checks the length of the file.
	if (buf.byteLength < 4 + 4 + 6 + 4 + 4) {
		throw makeError(`File too short (${buf.byteLength} byte(s))`, buf);
	}

	const content = {chunks: []};

	// Checks whether the file starts with a MacBinary or not.
	const macBinary = parseMacBinary(buf);
	if (macBinary) {
		// Treats the MacBinary as a chunk.
		const tag = '$MacBinary$';
		const payload = buf.subarray(0, 128);
		content.chunks.push({tag, tags: [tag], content: {payload, ...macBinary}});
		logs.push(makeWarn('Found MacBinary', payload));

		// Extracts the data fork as a new buffer.
		buf = extractDataFork(buf);
		console.assert(buf);
	}

	// Checks the file header.
	const tag = String.fromCharCode(...buf.subarray(0, 4));
	if (tag !== 'MThd' && tag !== 'RIFF' && !options.isForcedParsing) {
		throw makeError('Invalid header tag (neither MThd nor RIFF)', buf.subarray(0, 4));
	}

	// Parses the file.
	const chunks = parseChunk(buf, [], logs);
	content.chunks.push(...chunks);

	const mthdNum = chunks.filter((e) => (e.tag === 'MThd')).length;
	if (mthdNum > 1) {
		logs.push(makeWarn(`Contains ${mthdNum} MThd chunks. Ignored the latter chunk(s)`));
	}
	if (mthdNum > 0) {
		// Finds the first MThd.
		const mthdIndex = chunks.findIndex((e) => (e.tag === 'MThd'));
		console.assert(mthdIndex >= 0);
		const mthdChunk = chunks[mthdIndex];

		// Finds the group of MTrks which corresponds to the first MThd.
		const mtrkIndexArrays = chunks.map((e, i) => (e.tag === 'MTrk') ? i : -1).filter((e) => e >= 0).reduce((p, c) => {
			const target = p.find((e) => e[e.length - 1] === c - 1);
			if (target) {
				target.push(c);
			} else {
				p.push([c]);
			}
			return p;
		}, []);
		console.assert(mtrkIndexArrays.every((e) => e.length > 0));
		const mtrkChunks = (mtrkIndexArrays.find((e) => e.length > 0 && e[0] === mthdIndex + 1) || []).map((e) => chunks[e]);

		if (mthdChunk.content.ntrks !== mtrkChunks.length) {
			logs.push(makeWarn(`MThd.ntrks (${mthdChunk.content.ntrks}) is not equal to the number of MTrks (${mtrkChunks.length})`));
		}

		// Extracts MThd and MTrk(s) to make song object(s).
		if (mthdChunk.content.format !== 2) {
			const song = {MThd: mthdChunk.content, MTrks: mtrkChunks.map((e) => e.content)};
			const songs = [song];
			Object.assign(content, {song, songs});

		} else {
			const songs = mtrkChunks.map((e) => ({
				MThd: mthdChunk.content,
				MTrks: [e.content],
			}));
			const song = songs[0];
			Object.assign(content, {song, songs});
		}

		// Treats each MTrk in OTSc (One Touch Settings) as song.
		if (mtrkIndexArrays.length > 1) {
			const otsMtrkChunks = mtrkIndexArrays.find((e) => e[0] !== mthdIndex + 1).flat().map((e) => chunks[e]);
			content.songs.push(...otsMtrkChunks.filter((e) => e.tags.includes('OTSc')).map((e) => ({
				MThd: mthdChunk.content,
				MTrks: [e.content],
			})));
		}

	} else {
		logs.push(makeWarn('No MThd chunks'));
	}

	return content;
}
