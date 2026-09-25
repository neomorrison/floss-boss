// Reachability table (DESIGN 5.2), baked by out/cleanfu/bake.mjs from the GPU audit out/cleanfu/reach.mjs
// (1440x900, 1024x768 touch, 390x844 touch). Bit c of tooth i is set when, at every audited
// viewport, some provided view (Front, Left, Right, Upper, Lower or the mini-map focus) shows dirt cell c
// (u = (c % 32 + 0.5) / 32, v = (floor(c / 32) + 0.5) / 24) and a pointer can press it. Dirt only spawns there.
// Mirror-symmetric. Regenerate after changing the mouth layout, the pick proxies, the views or the focus camera.
const TABLE = [
  'AAAAAADgAwAA8AcAAP4DAAD+AwAA/gMAAP4DAAD+AwAA/AMAAPwDAAD8AwAA/AcAAPwHAAD8BwAA/A8AAP4PAAD+DwAA/g8AAP8fAMD/HwDA/x8C+P8//v/D//8AAAAA',
  'AAAAAADgBwAA8A8AAPgPAID/DwCA/w8AAP8PAAD/DwAA/x8AAP8fAAD+HwAA/h8AAP4fAAD+HwAA/h8AAP4fAAD/HwAA/x8AgP8fAMD/HwDA/x8C+P8//v/5//8AAPwD',
  'AAAAAADgBwAA8A8AwPkfAMD/HwDA/x8AwP8fAMD/HwCA/x8AAP8fAAD/HwAA/x8AAP8fAAD/HwAA/x8AgP8fAMD/HwDA/x8AwP8/AMD/PwDA/z8A/v8/AP//H+Dw/wEA',
  'AAAAAADABwAA8A8AAPAfAMD/HwDA/x8AwP8fAMD/PwDA/z8AwP8/AMD/PwDA/z8AwP8/AMD/PwDA/z8AwP8/AMD/PwDA/z8AwP8/AAD/PwDA/z8A/P8/iL//H/j/DwD4',
  'AAABAADwDwAA+H8AwP9/AMD/fwDA/38AwP9/AMD/fwDA/38AwP9/AMD/fwCA/38AgP9/AID/fwCA/38AgP9/AAD/fwCA/38AgP9/AMD//wDA//8AwP//AMD//wDA//8D',
  'AAAAAADwHwCA//8AwP//AMD//wDA//8AwP9/AMD/fwDA/38AwP9/AMD/fwCA/38AgP9/AID/fwAA/38AAP9/AAD/fwAA/38AAP9/AAD/fwAA/38AAP9/AAD//wCA//8B',
  'AAAAAADwDwCA/38BwP//AcD//wPA//8BwP//AYD//wGA//8BgP//AYD//wGA//8AAP//AAD//wAA//8AAP//AAD//wAA/38AAP9/AAD+fwAA/n8AAP5/AAD//wCA//8B',
  'AAAAAADwDwCA/v8BgP//A8D//wOA//8DgP//A4D//wGA//8BgP//AYD//wEA//8BAP//AAD//wAA//8AAP//AAD//wAA/v8AAP7/AAD+fwAA/n8AAP5/AAD//wCA//8B',
  'AAAAAAD4DwAA//8BAP//AwD//wMA//8DAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8BAP7/AQD+/wEA/v8AAP7/AAD+/wAA/v8AAP7/AAD+/wAA/v8AAP7/AAD//wCA//8B',
  'AIAAAADwDwAA/h8AAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8BAP7/AQD+/wEA/v8BAP7/AQD+/wAA/v8BAP7/AQD//wMA//8DAP//AwD//wPA//8D',
  'AAAAAADgAwAA8A8AAPgPAAD4/wMA+P8DAPj/AwD8/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wAA/P8DEfz/Px/4//0fAPD/',
  'AAAAAADgBwAA8A8AAPifAwD4/wMA+P8DAPj/AwD4/wMA+P8BAPj/AAD4/wAA+P8AAPj/AAD4/wAA+P8AAPj/AQD4/wMA+P8DAPz/AwD8/wMA/P8DAPz/fwf4//8AgP8P',
  'AAAAAADgBwAA8A8AAPAfAADw/wEA8P8BAPD/AADw/wAA+P8AAPj/AAD4fwAA+H8AAPh/AAD4fwAA+H8AAPh/AAD4/wAA+P8AAPj/AQD4/wNA+P8Df/z/H///n//APwAA',
  'AAAAAADABwAA4A8AAMB/AADAfwAAwH8AAMB/AADAfwAAwD8AAMA/AADAPwAA4D8AAOA/AADgPwAA8D8AAPB/AADwfwAA8H8AAPj/AAD4/wNA+P8Df/z/H///w/8AAAAA',
  'AAAAAADwBwAA8A8AAPB/AADwfwAA8H8AAPB/AADwPwAA8D8AAPA/AADwPwAA8D8AAPA/AADwPwAA8D8AAPA/AADwfwAA8H8AAPD/AwDw/wNA+P8Df/z/H///+/+AHwAA',
  'AAAAAADgBwAA8A8AAPAfAADw/wEA8P8AAPD/AAD4/wAA+P8AAPh/AAD4fwAA+H8AAPh/AAD4fwAA+H8AAPh/AAD4fwAA+P8AAPj/AQD4/wNA+P8Df/z/H//////wfwAA',
  'AAAAAADgBwAA8A8AAPifAwDw/wMA+P8DAPj/AwD4/wEA+P8BAPj/AAD4/wAA+P8AAPj/AAD4/wAA+P8AAPj/AQD4/wMA+P8DAPz/AwD8/wMA/P8DAPz//wf4//8DwP//',
  'AAAAAADgAwAA8A8AAPgPAAD4/wMA+P8DAPj/AwD4/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wMA/P8DAPz/AwD8/wIA/P8DEfz/Px/4//1/////',
  'AIAAAADwDwAA/j8AAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8BAP7/AQD+/wEA/v8BAP7/AQD+/wAA/v8BAP7/AwD//wMA//8DAP//AwD//wPA//8D',
  'AAAAAAD4DwAA//8BAP//AwD//wMA/v8DAP7/AwD+/wMA/v8DAP7/AwD+/wMA/v8BAP7/AQD+/wEA/v8AAP7/AAD+/wAA/v8AAP7/AAD+/wAA/v8AAP7/AAD//wCA//8B',
  'AAAAAAD4DwCA/v8BgP//A4D//wOA//8DgP//A4D//wGA//8BgP//AQD//wEA//8BAP//AAD//wAA//8AAP//AAD//wAA/v8AAP7/AAD+fwAA/n8AAP5/AAD//wCA//8B',
  'AAAAAADwHwCA/38BwP//AcD//wHA//8BwP//AYD//wGA//8BgP//AYD//wCA//8AAP//AAD//wAA//8AAP//AAD//wAA/38AAP9/AAD+fwAA/n8AAP5/AAD//wCA//8B',
  'AAAAAADwHwCA//8AwP//AMD//wDA/38AwP9/AMD/fwDA/38AwP9/AMD/fwCA/38AgP9/AID/fwAA/38AAP9/AAD/fwAA/38AAP9/AAD/fwAA/38AAP9/AAD//wCA//8B',
  'AAABAADwDwAA/H8AwP9/AMD/fwDA/38AwP9/AMD/fwDA/38AwP9/AMD/fwCA/38AgP9/AID/fwCA/38AgP9/AAD/fwCA/38AwP9/AMD//wDA//8AwP//AMD//wDA//8D',
  'AAAAAADABwAA8A8AAPAfAMD/HwDA/x8AwP8fAMD/HwDA/z8AwP8/AMD/PwDA/z8AwP8/AMD/PwDA/z8AwP8/AMD/PwDA/z8AwP8/AED/PwDA/z8A/P8/iL//H/j////+',
  'AAAAAADgBwAA8A8AwPkfAMD/DwDA/x8AwP8fAID/HwCA/x8AAP8fAAD/HwAA/x8AAP8fAAD/HwAA/x8AgP8fAMD/HwDA/x8AwP8/AMD/PwDA/z8A//8/AP//H+D//wPA',
  'AAAAAADgBwAA8A8AAPgPAID/DwAA/w8AAP8PAAD/HwAA/x8AAP4fAAD+HwAA/h8AAP4fAAD+HwAA/h8AAP4fAAD+HwAA/x8AgP8fAMD/HwDA/x8C+P8//v////8AAP4P',
  'AAAAAADgDwAA8A8AAP4PAAD+DwAA/g8AAP4PAAD8DwAA/A8AAPwPAAD8DwAA/A8AAPwPAAD8DwAA/A8AAPwPAAD+DwAA/g8AwP8PAMD/DwDA/x8C+P8//v/f//8AAPgB',
];

let bits: Uint8Array[] | null = null;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0, n = 0;
  for (const ch of s) {
    if (ch === '=') break;
    acc = (acc << 6) | B64.indexOf(ch); n += 6;
    if (n >= 8) { n -= 8; out.push((acc >> n) & 255); }
  }
  return Uint8Array.from(out);
}

/** Can a pointer press dirt cell `cell` of tooth `index` from one of the provided views? */
export function pressable(index: number, cell: number): boolean {
  if (!bits) bits = TABLE.map(decode);
  const b = bits[index];
  if (!b) return false;
  return ((b[cell >> 3] >> (cell & 7)) & 1) === 1;
}
