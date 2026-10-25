import {
	makeArchiveError, normalizeOptions, createByteSource,
	readUint16, readUint32, readUint64, readLatin1, convertDosTimestamp, convertUnixTimestamp, computeCrc16,
} from './archive_common.js';

// A level 2 header is at most 64 KiB. (A level 3 header can be larger, but such headers do not exist in practice.)
const maxHeaderWindowSize = 0x10000 + 32;

const minHeaderLength = 22;
// Known method IDs. Used to tell a real header from random bytes when scanning a self-extracting stub.
const knownMethodRegExp = /^-(?:lh[0-9a-fx]|lz[s54]|pm[0-2])-$/u;

// Dictionary size (in bits) of each method. The decoder kind is derived from the method ID.
const methodDictBits = {
	'-lh0-': 0,
	'-lh1-': 12,
	'-lh4-': 12,
	'-lh5-': 13,
	'-lh6-': 15,
	'-lh7-': 16,
	'-lzs-': 11,
	'-lz5-': 12,
	'-lz4-': 0,
	'-lhd-': 0,
};

const maxMatch = 256;
const threshold = 3;

const numTreeChars = 19;							// NT: 16 + 3
const treeLengthBits = 5;							// TBIT

const numChars = 256 + maxMatch + 2 - threshold;	// NC: 510
const codeLengthBits = 9;							// CBIT
const charTableBits = 12;

const maxPositionCodes = 0x80;						// NPT
const positionTableBits = 8;

export function isLzhArchive(bytes) {
	console.assert(bytes instanceof Uint8Array);

	return isLzhHeader(bytes, 0);
}

// Finds the offset of the first header. Returns -1 if not found within the scan size.
export async function findLzhHeaderOffset(byteSource, maxScanSize) {
	console.assert(Number.isInteger(maxScanSize) && maxScanSize >= 0);

	const headBytes = await byteSource.read(0, Math.max(maxScanSize, maxHeaderWindowSize));

	if (isLzhHeader(headBytes, 0)) {
		return 0;
	}
	if (maxScanSize === 0) {
		return -1;
	}
	return findLzhHeader(headBytes.subarray(0, maxScanSize + maxHeaderWindowSize));

	// Scans the bytes for the first header. Returns -1 if not found.
	function findLzhHeader(bytes) {
		console.assert(bytes instanceof Uint8Array);

		for (let offset = 0; offset + minHeaderLength <= bytes.length; offset++) {
			if (bytes[offset + 2] === 0x2d && bytes[offset + 3] === 0x6c && isLzhHeader(bytes, offset)) {
				return offset;
			}
		}

		return -1;
	}
}

export async function openLzhArchive(source, options = {}) {
	const byteSource = createByteSource(source);
	const {maxHeaderScanSize, decodeFileName, isCrcVerified} = normalizeOptions(options);

	const startOffset = await findLzhHeaderOffset(byteSource, maxHeaderScanSize);
	if (startOffset < 0) {
		throw makeArchiveError('Not an LZH archive');
	}

	// Reads the headers one by one. The compressed data is skipped by its size.
	const entries = [];
	let offset = startOffset;
	while (offset < byteSource.size) {
		const windowBytes = await byteSource.read(offset, Math.min(maxHeaderWindowSize, byteSource.size - offset));

		// Stops at the end marker. Also stops silently at garbage after at least one entry (some tools leave it).
		if (windowBytes[0] === 0 || (entries.length > 0 && !isLzhHeader(windowBytes, 0))) {
			break;
		}

		const header = parseLzhHeader(windowBytes);
		console.assert(header !== null);
		entries.push(makeEntry(header, entries.length, offset, decodeFileName));

		offset += header.headerSize + header.compressedSize;
	}

	async function readEntry(entry) {
		if (entries[entry?.index] !== entry) {
			throw makeArchiveError('The entry does not belong to this archive');
		}
		if (entry.isDirectory) {
			return new Uint8Array(0);
		}
		if (!isSupportedLzhMethod(entry.method)) {
			throw makeArchiveError(`Unsupported LZH method: ${entry.method}`);
		}
		// LHARK (OS type ' ') uses the ID -lh7- for its own incompatible algorithm.
		if (entry.method === '-lh7-' && entry.headerLevel === 1 && entry.osType === ' ') {
			throw makeArchiveError('Unsupported LZH method: -lh7- of LHARK');
		}

		const compressedBytes = await byteSource.read(entry.dataOffset, entry.compressedSize);
		if (compressedBytes.length < entry.compressedSize) {
			throw makeArchiveError('Compressed data is truncated');
		}

		const bytes = decodeLzh(entry.method, compressedBytes, entry.originalSize);
		if (bytes.length !== entry.originalSize) {
			throw makeArchiveError('Decoded size does not match the header');
		}
		if (isCrcVerified && entry.crc !== null && computeCrc16(bytes) !== entry.crc) {
			throw makeArchiveError('CRC mismatch');
		}
		return bytes;
	}

	return Object.freeze({
		format: 'lzh',
		entries: Object.freeze(entries),
		readEntry,
	});
}

// Checks whether a plausible LZH header starts at the offset. It does not parse the whole header.
function isLzhHeader(bytes, offset = 0) {
	console.assert(bytes instanceof Uint8Array && Number.isInteger(offset));

	if (offset < 0 || offset + minHeaderLength > bytes.length) {
		return false;
	}
	if (!knownMethodRegExp.test(readLatin1(bytes, offset + 2, 5))) {
		return false;
	}

	const level = bytes[offset + 20];
	if (level === 0 || level === 1) {
		// The checksum is the strongest evidence for level 0/1.
		const headerSize = bytes[offset];
		if (headerSize < minHeaderLength - 2 || offset + 2 + headerSize > bytes.length) {
			return false;
		}
		return (computeChecksum(bytes, offset + 2, headerSize) === bytes[offset + 1]);
	} else if (level === 2) {
		// Some archivers (Amiga LHA) do not write 0x20 to the reserved byte, so only the size is checked.
		return (readUint16(bytes, offset) >= 26);
	} else if (level === 3) {
		return (readUint16(bytes, offset) === 4);
	} else {
		return false;
	}
}

function computeChecksum(bytes, offset, length) {
	let sum = 0;
	for (let i = offset; i < offset + length; i++) {
		sum += bytes[i];
	}
	return sum & 0xff;
}

// Parses one header at the beginning of the bytes. Returns null at the end marker.
function parseLzhHeader(bytes) {
	console.assert(bytes instanceof Uint8Array);

	if (bytes.length === 0 || bytes[0] === 0) {
		return null;
	}
	if (bytes.length < minHeaderLength) {
		throw makeArchiveError('Truncated LZH header');
	}

	const method = readLatin1(bytes, 2, 5);
	if (!knownMethodRegExp.test(method)) {
		throw makeArchiveError(`Invalid LZH header: unknown method "${method}"`);
	}

	const level = bytes[20];
	const header = {
		headerSize:      0,
		method,
		compressedSize:  readUint32(bytes, 7),
		originalSize:    readUint32(bytes, 11),
		timestamp:       null,
		attribute:       null,
		headerLevel:     level,
		rawName:         new Uint8Array(0),
		crc:             null,
		osType:          null,
		rawDirectory:    null,
		extendedHeaders: [],
		extendedHeaderRecords: [],	// With offsets, for the header CRC. Removed before returning.
	};

	switch (level) {
	case 0:
		parseLevel0(bytes, header);
		break;
	case 1:
		parseLevel1(bytes, header);
		break;
	case 2:
		parseLevel2(bytes, header);
		break;
	case 3:
		parseLevel3(bytes, header);
		break;
	default:
		throw makeArchiveError(`Unsupported LZH header level: ${level}`);
	}

	applyExtendedHeaders(header);
	delete header.extendedHeaderRecords;

	return header;

	function parseLevel0(bytes, header) {
		const headerSize = bytes[0] + 2;
		verifyChecksum(bytes, headerSize);

		const nameLength = bytes[21];
		const extendSize = headerSize - nameLength - 24;
		if (extendSize < -2 || extendSize === -1 || 22 + nameLength > headerSize) {
			throw makeArchiveError('Invalid LZH level 0 header');
		}

		header.headerSize = headerSize;
		header.timestamp = convertDosTimestamp(readUint16(bytes, 15), readUint16(bytes, 17));
		header.attribute = bytes[19];
		header.rawName = bytes.slice(22, 22 + nameLength);

		// A very old header may have no CRC field.
		if (extendSize === -2) {
			return;
		}

		header.crc = readUint16(bytes, 22 + nameLength);

		// LHa for UNIX adds an extension area: OS type 'U', minor version, Unix time, mode, uid, gid.
		if (extendSize > 0) {
			header.osType = String.fromCharCode(bytes[24 + nameLength]);
			if (header.osType === 'U' && extendSize >= 12) {
				header.timestamp = convertUnixTimestamp(readUint32(bytes, 26 + nameLength));
			}
		}
	}

	function parseLevel1(bytes, header) {
		const baseSize = bytes[0] + 2;
		verifyChecksum(bytes, baseSize);

		const nameLength = bytes[21];
		if (baseSize < 27 + nameLength) {
			throw makeArchiveError('Invalid LZH level 1 header');
		}

		header.timestamp = convertDosTimestamp(readUint16(bytes, 15), readUint16(bytes, 17));
		header.attribute = bytes[19];
		header.rawName = bytes.slice(22, 22 + nameLength);
		header.crc = readUint16(bytes, 22 + nameLength);
		header.osType = String.fromCharCode(bytes[24 + nameLength]);

		// The size of the first extended header is at the end of the base header. (An old style extension area may be between.)
		const {size: extendedSize} = readExtendedHeaders(bytes, baseSize, readUint16(bytes, baseSize - 2), 2, header);
		header.headerSize = baseSize + extendedSize;

		// On level 1, the packed size field includes the extended headers.
		header.compressedSize -= extendedSize;
		if (header.compressedSize < 0) {
			throw makeArchiveError('Invalid LZH level 1 header');
		}
	}

	function parseLevel2(bytes, header) {
		const headerSize = readUint16(bytes, 0);
		if (headerSize < 26 || headerSize > bytes.length) {
			throw makeArchiveError('Truncated LZH level 2 header');
		}

		header.timestamp = convertUnixTimestamp(readUint32(bytes, 15));
		header.crc = readUint16(bytes, 21);
		header.osType = String.fromCharCode(bytes[23]);

		// The header may end with 1 byte of padding, which is covered by the header size.
		// OS-9/68k LHa writes a header size which is 2 bytes too small, so the chain is followed beyond it if needed.
		const {size} = readExtendedHeaders(bytes, 26, readUint16(bytes, 24), 2, header);
		header.headerSize = Math.max(headerSize, 26 + size);
		verifyHeaderCrc(bytes.subarray(0, header.headerSize), header.extendedHeaderRecords);
	}

	function parseLevel3(bytes, header) {
		if (readUint16(bytes, 0) !== 4 || bytes.length < 32) {
			throw makeArchiveError('Invalid LZH level 3 header');
		}
		const headerSize = readUint32(bytes, 24);
		if (headerSize < 32 || headerSize > bytes.length) {
			throw makeArchiveError('Truncated LZH level 3 header');
		}

		header.headerSize = headerSize;
		header.timestamp = convertUnixTimestamp(readUint32(bytes, 15));
		header.crc = readUint16(bytes, 21);
		header.osType = String.fromCharCode(bytes[23]);

		readExtendedHeaders(bytes.subarray(0, headerSize), 32, readUint32(bytes, 28), 4, header);
		verifyHeaderCrc(bytes.subarray(0, headerSize), header.extendedHeaderRecords);
	}

	// Reads the chain of extended headers. Returns the total size of them and the records with their offsets.
	function readExtendedHeaders(bytes, offset, firstSize, sizeFieldLength, header) {
		console.assert(sizeFieldLength === 2 || sizeFieldLength === 4);

		const readSize = (sizeFieldLength === 2) ? readUint16 : readUint32;
		const records = [];
		let pos = offset;
		let size = firstSize;

		while (size !== 0) {
			if (size < 1 + sizeFieldLength || pos + size > bytes.length) {
				throw makeArchiveError('Truncated LZH extended header');
			}
			records.push({
				type:   bytes[pos],
				bytes:  bytes.slice(pos + 1, pos + size - sizeFieldLength),
				offset: pos,
			});
			pos += size;
			size = readSize(bytes, pos - sizeFieldLength);
		}

		header.extendedHeaders = records.map((e) => ({type: e.type, bytes: e.bytes}));
		header.extendedHeaderRecords = records;
		return {size: pos - offset};
	}

	function applyExtendedHeaders(header) {
		for (const {type, bytes} of header.extendedHeaders) {
			switch (type) {
			case 0x01:	// File name
				header.rawName = bytes;
				break;
			case 0x02:	// Directory name (separated by 0xff)
				header.rawDirectory = bytes;
				break;
			case 0x40:	// MS-DOS attribute
				if (bytes.length >= 2) {
					header.attribute = readUint16(bytes, 0);
				}
				break;
			case 0x42:	// 64-bit file sizes (UNLHA32 extension)
				if (bytes.length >= 16) {
					header.compressedSize = readUint64(bytes, 0);
					header.originalSize = readUint64(bytes, 8);
				}
				break;
			case 0x54:	// Unix last modified time
				if (bytes.length >= 4) {
					header.timestamp = convertUnixTimestamp(readUint32(bytes, 0));
				}
				break;
			default:
				break;
			}
		}
	}

	function verifyChecksum(bytes, headerSize) {
		if (headerSize > bytes.length) {
			throw makeArchiveError('Truncated LZH header');
		}
		if (computeChecksum(bytes, 2, headerSize - 2) !== bytes[1]) {
			throw makeArchiveError('LZH header checksum mismatch');
		}
	}

	// Verifies the header CRC stored in the extended header 0x00. It is computed with the CRC field itself set to 0.
	function verifyHeaderCrc(headerBytes, records) {
		const record = records.find((e) => (e.type === 0x00 && e.bytes.length >= 2));
		if (!record) {
			return;
		}

		const copiedBytes = headerBytes.slice();
		copiedBytes[record.offset + 1] = 0;
		copiedBytes[record.offset + 2] = 0;

		if (computeCrc16(copiedBytes) !== readUint16(record.bytes, 0)) {
			throw makeArchiveError('LZH header CRC mismatch');
		}
	}
}

function makeEntry(header, index, headerOffset, decodeFileName) {
	// Level 0/1 headers may hold a path in the name field. It is split at '\' and '/' after decoding, so that any encoding works.
	const directoryNames = (header.rawDirectory) ? splitPathBytes(header.rawDirectory).map((e) => decodeFileName(e)) : [];
	const pathNames = splitPathBytes(header.rawName).flatMap((e) => decodeFileName(e).split(/[\\/]/u));

	let directory = [...directoryNames, ...pathNames.slice(0, -1)].filter((e) => (e.length > 0)).map((e) => `${e}/`).join('');
	let name = pathNames.at(-1);

	// A directory entry has the whole path in the directory part.
	const isDirectory = (header.method === '-lhd-');
	if (isDirectory && name.length > 0) {
		directory += `${name}/`;
		name = '';
	}

	// The raw path joins the directory extended header and the name with 0xff, the path separator of LHA.
	const rawDirectory = header.rawDirectory ?? new Uint8Array(0);
	const rawSeparator = (rawDirectory.length > 0 && rawDirectory.at(-1) !== 0xff) ? [0xff] : [];
	const rawName = new Uint8Array([...rawDirectory, ...rawSeparator, ...header.rawName]);

	return Object.freeze({
		index,
		directory,
		name,
		rawName,
		isDirectory,
		method:          header.method,
		compressedSize:  header.compressedSize,
		originalSize:    header.originalSize,
		timestamp:       header.timestamp,
		crc:             header.crc,
		attribute:       header.attribute,
		headerOffset,
		dataOffset:      headerOffset + header.headerSize,
		headerLevel:     header.headerLevel,
		osType:          header.osType,
		extendedHeaders: Object.freeze(header.extendedHeaders.map((e) => Object.freeze(e))),
	});
}

// Splits path bytes at 0xff (the path separator of LHA). Shift_JIS, UTF-8, and EUC-JP never use 0xff, so no decoding is needed.
function splitPathBytes(bytes) {
	const segments = [];
	let start = 0;

	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0xff) {
			segments.push(bytes.subarray(start, i));
			start = i + 1;
		}
	}

	segments.push(bytes.subarray(start));
	return segments;
}

function isSupportedLzhMethod(method) {
	return (method in methodDictBits);
}

// Reads bits from the most significant bit first. Bits beyond the end are read as 0, like LHA does.
class BitReader {
	constructor(bytes) {
		console.assert(bytes instanceof Uint8Array);

		this.bytes = bytes;
		this.pos = 0;
		this.bitBuffer = 0;
		this.bitCount = 0;
	}

	fill(count) {
		while (this.bitCount < count) {
			const byte = (this.pos < this.bytes.length) ? this.bytes[this.pos] : 0;
			this.pos++;
			this.bitBuffer = ((this.bitBuffer << 8) | byte) >>> 0;
			this.bitCount += 8;
		}
	}

	peekBits(count) {
		console.assert(0 < count && count <= 16);

		this.fill(count);
		return (this.bitBuffer >>> (this.bitCount - count)) & ((1 << count) - 1);
	}

	skipBits(count) {
		console.assert(0 <= count && count <= this.bitCount);

		this.bitCount -= count;
		this.bitBuffer &= (2 ** this.bitCount) - 1;
	}

	readBits(count) {
		if (count === 0) {
			return 0;
		}

		const value = this.peekBits(count);
		this.skipBits(count);
		return value;
	}

	readBit() {
		return this.readBits(1);
	}
}

function decodeLzh(method, bytes, originalSize) {
	console.assert(typeof method === 'string' && bytes instanceof Uint8Array && Number.isInteger(originalSize) && originalSize >= 0);

	if (!isSupportedLzhMethod(method)) {
		throw makeArchiveError(`Unsupported LZH method: ${method}`);
	}

	switch (method) {
	case '-lh0-':
	case '-lz4-':
	case '-lhd-':
		if (bytes.length < originalSize) {
			throw makeArchiveError('Compressed data is too short');
		}
		return bytes.slice(0, originalSize);
	case '-lh1-':
		return decodeLzHuffman(bytes, originalSize, methodDictBits[method], createDynamicHuffmanDecoder);
	case '-lh4-':
	case '-lh5-':
	case '-lh6-':
	case '-lh7-':
		return decodeLzHuffman(bytes, originalSize, methodDictBits[method], createStaticHuffmanDecoder);
	case '-lzs-':
		return decodeLzs(bytes, originalSize);
	case '-lz5-':
		return decodeLz5(bytes, originalSize);
	default:
		console.assert(false, `Unexpected method: ${method}`);
		return null;
	}

	// Makes a lookup table (for short codes) and a binary tree (for long codes) from the code lengths.
	function makeHuffmanTable(numCodes, codeLengths, tableBits, table, left, right) {
		console.assert(numCodes <= codeLengths.length && table.length === (1 << tableBits));

		const counts = new Uint16Array(17);
		const weights = new Uint32Array(17);
		const starts = new Uint32Array(17);

		for (let i = 0; i < numCodes; i++) {
			if (codeLengths[i] > 16) {
				throw makeArchiveError('Broken compressed data: bad Huffman table');
			}
			counts[codeLengths[i]]++;
		}

		let total = 0;

		for (let i = 1; i <= 16; i++) {
			weights[i] = 1 << (16 - i);
			starts[i] = total;
			total += weights[i] * counts[i];
		}

		if ((total & 0xffff) !== 0) {
			throw makeArchiveError('Broken compressed data: bad Huffman table');
		}

		const shift = 16 - tableBits;

		for (let i = 1; i <= tableBits; i++) {
			starts[i] >>>= shift;
			weights[i] >>>= shift;
		}

		// Entries which no short code covers are the roots of the trees for long codes.
		const treeStart = starts[tableBits + 1] >>> shift;
		if (treeStart !== 0) {
			table.fill(0, treeStart, table.length);
		}

		let avail = numCodes;

		for (let code = 0; code < numCodes; code++) {
			const length = codeLengths[code];
			if (length === 0) {
				continue;
			}
			const nextStart = starts[length] + weights[length];
			if (length <= tableBits) {
				table.fill(code, starts[length], Math.min(nextStart, table.length));
			} else {
				let index = starts[length];
				if ((index >>> shift) >= table.length) {
					throw makeArchiveError('Broken compressed data: bad Huffman table');
				}

				// Walks down from the table entry, creating tree nodes as needed. (nodes array and index stand for a pointer)
				let nodes = table;
				let nodeIndex = index >>> shift;
				index = (index << tableBits) & 0xffff;

				for (let depth = length - tableBits; depth > 0; depth--) {
					if (nodes[nodeIndex] === 0) {
						if (avail >= left.length) {
							throw makeArchiveError('Broken compressed data: bad Huffman table');
						}
						left[avail] = 0;
						right[avail] = 0;
						nodes[nodeIndex] = avail++;
					}
					const nodeNo = nodes[nodeIndex];
					nodes = ((index & 0x8000) !== 0) ? right : left;
					nodeIndex = nodeNo;
					index = (index << 1) & 0xffff;
				}

				nodes[nodeIndex] = code;
			}
			starts[length] = nextStart;
		}
	}

	// Decodes one symbol with the table and the tree made by makeHuffmanTable.
	function decodeHuffmanSymbol(reader, numCodes, codeLengths, tableBits, table, left, right) {
		let code = table[reader.peekBits(tableBits)];
		if (code < numCodes) {
			reader.skipBits(codeLengths[code]);
			return code;
		}

		reader.skipBits(tableBits);

		for (let depth = 0; depth <= 16; depth++) {
			code = (reader.readBit() !== 0) ? right[code] : left[code];
			if (code < numCodes) {
				return code;
			}
		}

		throw makeArchiveError('Broken compressed data: bad Huffman code');
	}

	// LZSS decoding shared by -lh1- and -lh4- to -lh7-. The output buffer itself works as the sliding dictionary.
	function decodeLzHuffman(bytes, originalSize, dictBits, createDecoder) {
		const reader = new BitReader(bytes);
		const decoder = createDecoder(reader, dictBits);
		const output = new Uint8Array(originalSize);

		let outPos = 0;

		while (outPos < originalSize) {
			const code = decoder.decodeChar();
			if (code < 256) {
				output[outPos++] = code;
			} else {
				const length = code - (256 - threshold);
				const offset = decoder.decodePosition() + 1;
				let srcPos = outPos - offset;

				for (let i = 0; i < length && outPos < originalSize; i++) {
					// LHA fills the dictionary with spaces, so a reference before the beginning reads a space.
					output[outPos++] = (srcPos >= 0) ? output[srcPos] : 0x20;
					srcPos++;
				}
			}
		}

		return output;
	}

	// -lh1-: adaptive Huffman coding for characters (ported from LHarc) and a fixed Huffman table for positions.
	function createDynamicHuffmanDecoder(reader, dictBits) {
		console.assert(dictBits === 12);

		const numSymbols = 314;			// 256 characters + 58 match lengths (3 to 60)
		const treeSize = numSymbols * 2;
		const rootIndex = 0;
		const maxFrequency = 0x8000;

		const child = new Int16Array(treeSize);		// Negative values are leaves: ~symbol
		const parent = new Int16Array(treeSize);
		const block = new Int16Array(treeSize);
		const edge = new Int16Array(treeSize);
		const stock = new Int16Array(treeSize);
		const symbolNode = new Int16Array(numSymbols);
		const freq = new Uint16Array(treeSize);
		let avail = 0;

		// Builds the initial tree in which all symbols have the frequency 1.
		function startTree() {
			for (let i = 0; i < treeSize; i++) {
				stock[i] = i;
				block[i] = 0;
			}

			let j = numSymbols * 2 - 2;

			for (let i = 0; i < numSymbols; i++, j--) {
				freq[j] = 1;
				child[j] = ~i;
				symbolNode[i] = j;
				block[j] = 1;
			}

			avail = 2;
			edge[1] = numSymbols - 1;
			let i = numSymbols * 2 - 2;

			while (j >= 0) {
				const f = freq[i] + freq[i - 1];
				freq[j] = f;
				child[j] = i;
				parent[i] = j;
				parent[i - 1] = j;
				if (f === freq[j + 1]) {
					block[j] = block[j + 1];
					edge[block[j]] = j;
				} else {
					block[j] = stock[avail++];
					edge[block[j]] = j;
				}
				i -= 2;
				j--;
			}
		}

		// Halves the frequencies and rebuilds the tree when the root frequency reaches the limit.
		function reconstruct(start, end) {
			let j = start;
			let b = 0;

			for (let i = start; i < end; i++) {
				const k = child[i];
				if (k < 0) {
					freq[j] = (freq[i] + 1) >>> 1;
					child[j] = k;
					j++;
				}

				b = block[i];
				if (edge[b] === i) {
					stock[--avail] = b;
				}
			}

			j--;
			let i = end - 1;
			let l = end - 2;

			while (i >= start) {
				while (i >= l) {
					freq[i] = freq[j];
					child[i] = child[j];
					i--;
					j--;
				}

				const f = freq[l] + freq[l + 1];
				let k = start;

				while (f < freq[k]) {
					k++;
				}

				while (j >= k) {
					freq[i] = freq[j];
					child[i] = child[j];
					i--;
					j--;
				}

				freq[i] = f;
				child[i] = l + 1;
				i--;
				l -= 2;
			}

			let f = 0;

			for (let n = start; n < end; n++) {
				const k = child[n];
				if (k < 0) {
					symbolNode[~k] = n;
				} else {
					parent[k] = n;
					parent[k - 1] = n;
				}

				const g = freq[n];
				if (g === f) {
					block[n] = b;
				} else {
					b = stock[avail++];
					block[n] = b;
					edge[b] = n;
					f = g;
				}
			}
		}

		// Increments the frequency of the node, swapping it with the leader of its block to keep the tree ordered. Returns the parent.
		function swapAndIncrement(nodeIndex) {
			let p = nodeIndex;
			const b = block[p];
			const q = edge[b];
			let isAdjusted = false;
			if (q !== p) {
				const r = child[p];
				const s = child[q];
				child[p] = s;
				child[q] = r;
				if (r >= 0) {
					parent[r] = q;
					parent[r - 1] = q;
				} else {
					symbolNode[~r] = q;
				}
				if (s >= 0) {
					parent[s] = p;
					parent[s - 1] = p;
				} else {
					symbolNode[~s] = p;
				}
				p = q;
				isAdjusted = true;
			} else if (b === block[p + 1]) {
				isAdjusted = true;
			}

			if (isAdjusted) {
				edge[b]++;
				if (++freq[p] === freq[p - 1]) {
					block[p] = block[p - 1];
				} else {
					block[p] = stock[avail++];
					edge[block[p]] = p;
				}
			} else if (++freq[p] === freq[p - 1]) {
				stock[--avail] = b;
				block[p] = block[p - 1];
			}

			return parent[p];
		}

		function updateTree(symbol) {
			if (freq[rootIndex] === maxFrequency) {
				reconstruct(0, numSymbols * 2 - 1);
			}
			freq[rootIndex]++;
			let q = symbolNode[symbol];

			do {
				q = swapAndIncrement(q);
			} while (q !== rootIndex);
		}

		// The position tree is fixed: 6 bits of the position are Huffman coded, and the lower 6 bits follow as they are.
		const numPositions = 1 << (dictBits - 6);
		const positionLengths = new Uint8Array(numPositions);
		const positionTable = new Uint16Array(1 << positionTableBits);
		const left = new Uint16Array(2 * numPositions);
		const right = new Uint16Array(2 * numPositions);
		{
			// Code lengths: 3 for code 0, 4 for codes 1-3, 5 for 4-11, 6 for 12-23, 7 for 24-47, 8 for 48-63.
			const boundaries = [1, 4, 12, 24, 48];
			let length = 3;

			for (let i = 0; i < numPositions; i++) {
				if (boundaries.includes(i)) {
					length++;
				}
				positionLengths[i] = length;
			}

			makeHuffmanTable(numPositions, positionLengths, positionTableBits, positionTable, left, right);
		}

		startTree();

		return {
			decodeChar() {
				let c = child[rootIndex];
				let depth = 0;

				do {
					// A 1 bit goes to the left child (index - 1), a 0 bit goes to the right child (index).
					c = child[c - reader.readBit()];
					if (++depth > treeSize) {
						throw makeArchiveError('Broken compressed data: bad Huffman code');
					}
				} while (c > 0);

				const symbol = ~c;
				updateTree(symbol);
				return symbol;
			},
			decodePosition() {
				const code = decodeHuffmanSymbol(reader, numPositions, positionLengths, positionTableBits, positionTable, left, right);
				return (code << 6) + reader.readBits(6);
			},
		};
	}

	// -lh4- to -lh7-: static Huffman coding renewed for each block.
	function createStaticHuffmanDecoder(reader, dictBits) {
		// -lh4- shares the parameters of -lh5-.
		const numPositions = Math.max(dictBits, 13) + 1;
		const positionLengthBits = (dictBits <= 13) ? 4 : 5;

		const charLengths = new Uint8Array(numChars);
		const charTable = new Uint16Array(1 << charTableBits);
		const positionLengths = new Uint8Array(maxPositionCodes);
		const positionTable = new Uint16Array(1 << positionTableBits);
		const left = new Uint16Array(2 * numChars - 1);
		const right = new Uint16Array(2 * numChars - 1);

		let blockSize = 0;

		// Reads the code lengths of the code length tree (NT) or the position tree (NP).
		function readPositionLengths(numCodes, numBits, specialIndex) {
			const count = reader.readBits(numBits);
			if (count === 0) {
				const code = reader.readBits(numBits);
				positionLengths.fill(0);
				positionTable.fill(code);
				return;
			}

			let i = 0;

			while (i < Math.min(count, maxPositionCodes)) {
				let length = reader.peekBits(3);
				if (length !== 7) {
					reader.skipBits(3);
				} else {
					// A length of 7 or more is coded as 111 followed by (length - 7) 1s and a 0.
					reader.skipBits(3);

					while (reader.readBit() !== 0) {
						length++;
					}
				}

				positionLengths[i++] = length;

				if (i === specialIndex) {
					let zeros = reader.readBits(2);

					while (--zeros >= 0 && i < maxPositionCodes) {
						positionLengths[i++] = 0;
					}
				}
			}

			positionLengths.fill(0, i, numCodes);
			makeHuffmanTable(numCodes, positionLengths, positionTableBits, positionTable, left, right);
		}

		// Reads the code lengths of the character tree (NC), which are coded with the code length tree.
		function readCharLengths() {
			const count = reader.readBits(codeLengthBits);
			if (count === 0) {
				const code = reader.readBits(codeLengthBits);
				charLengths.fill(0);
				charTable.fill(code);
				return;
			}

			let i = 0;

			while (i < Math.min(count, numChars)) {
				let code = decodeHuffmanSymbol(reader, numTreeChars, positionLengths, positionTableBits, positionTable, left, right);
				if (code <= 2) {
					// 0, 1, and 2 mean runs of zero lengths.
					if (code === 0) {
						code = 1;
					} else if (code === 1) {
						code = reader.readBits(4) + 3;
					} else {
						code = reader.readBits(codeLengthBits) + 20;
					}

					while (--code >= 0 && i < numChars) {
						charLengths[i++] = 0;
					}
				} else {
					charLengths[i++] = code - 2;
				}
			}

			charLengths.fill(0, i, numChars);
			makeHuffmanTable(numChars, charLengths, charTableBits, charTable, left, right);
		}

		return {
			decodeChar() {
				if (blockSize === 0) {
					blockSize = reader.readBits(16);
					readPositionLengths(numTreeChars, treeLengthBits, 3);
					readCharLengths();
					readPositionLengths(numPositions, positionLengthBits, -1);
				}
				blockSize--;
				return decodeHuffmanSymbol(reader, numChars, charLengths, charTableBits, charTable, left, right);
			},
			decodePosition() {
				const code = decodeHuffmanSymbol(reader, numPositions, positionLengths, positionTableBits, positionTable, left, right);
				return (code !== 0) ? (1 << (code - 1)) + reader.readBits(code - 1) : 0;
			},
		};
	}

	// -lzs- (LArc): LZSS with a 2 KiB ring buffer of spaces. Positions are absolute in the ring.
	function decodeLzs(bytes, originalSize) {
		const ringSize = 2048;
		const ring = new Uint8Array(ringSize).fill(0x20);
		let ringPos = ringSize - 17;

		const reader = new BitReader(bytes);
		const output = new Uint8Array(originalSize);
		let outPos = 0;

		while (outPos < originalSize) {
			if (reader.readBit() !== 0) {
				const byte = reader.readBits(8);
				output[outPos++] = byte;
				ring[ringPos] = byte;
				ringPos = (ringPos + 1) & (ringSize - 1);
			} else {
				const matchPos = reader.readBits(11);
				const length = reader.readBits(4) + 2;

				for (let i = 0; i < length && outPos < originalSize; i++) {
					const byte = ring[(matchPos + i) & (ringSize - 1)];
					output[outPos++] = byte;
					ring[ringPos] = byte;
					ringPos = (ringPos + 1) & (ringSize - 1);
				}
			}
		}

		return output;
	}

	// -lz5- (LArc): LZSS with a 4 KiB ring buffer which is pre-filled with a fixed pattern. Positions are absolute in the ring.
	function decodeLz5(bytes, originalSize) {
		const ringSize = 4096;
		const ring = new Uint8Array(ringSize);	// The last 18 bytes (after the pattern) are 0.
		let ringPos = 0;

		for (let i = 0; i < 256; i++) {
			ring.fill(i, ringPos, ringPos + 13);
			ringPos += 13;
		}
		for (let i = 0; i < 256; i++) {
			ring[ringPos++] = i;
		}
		for (let i = 0; i < 256; i++) {
			ring[ringPos++] = 255 - i;
		}

		ring.fill(0, ringPos, ringPos + 128);
		ringPos += 128;
		ring.fill(0x20, ringPos, ringPos + 110);
		ringPos += 110;
		console.assert(ringPos === ringSize - 18);

		const output = new Uint8Array(originalSize);
		let outPos = 0;
		let inPos = 0;
		let flags = 0;
		let flagCount = 0;

		const readByte = () => ((inPos < bytes.length) ? bytes[inPos++] : 0);

		while (outPos < originalSize) {
			if (flagCount === 0) {
				flags = readByte();
				flagCount = 8;
			}
			flagCount--;

			if ((flags & 1) !== 0) {
				const byte = readByte();
				output[outPos++] = byte;
				ring[ringPos] = byte;
				ringPos = (ringPos + 1) & (ringSize - 1);
			} else {
				const low = readByte();
				const high = readByte();
				const matchPos = low | ((high & 0xf0) << 4);
				const length = (high & 0x0f) + 3;

				for (let i = 0; i < length && outPos < originalSize; i++) {
					const byte = ring[(matchPos + i) & (ringSize - 1)];
					output[outPos++] = byte;
					ring[ringPos] = byte;
					ringPos = (ringPos + 1) & (ringSize - 1);
				}
			}
			flags >>= 1;
		}

		return output;
	}
}
