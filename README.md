Remiana
=======

![Remiana - Realtime MIDI File Analyzer/Player](./remiana.svg)

(Under development)


PoC
---

This is a PoC as a feasibility study of a MIDI player application using the Web MIDI API and the below components.

* [midi-file-player](https://shingo45endo.github.io/remiana/midi-file-player/): Simple MIDI File Player


Sub components
--------------

The following sub components will be part of Remiana:

* [midiana](https://github.com/shingo45endo/midiana):
	* Modules of MIDI file and MIDI event analyzer.
* [sound-canvas-lcd](https://github.com/shingo45endo/sound-canvas-lcd)
	* A Web Component to display LCD panel like Roland Sound Canvas.
* [rcm2smf](https://github.com/shingo45endo/rcm2smf)
	* Recomposer file (.RCP, .R36, .G36, and .MCP) to Standard MIDI File (.mid) converter.

And the following results of researching on some MIDI sound modules will be used for Remiana internally:

* [tone-para](https://github.com/shingo45endo/tone-para)
* [tone-browser](https://github.com/shingo45endo/tone-browser)
