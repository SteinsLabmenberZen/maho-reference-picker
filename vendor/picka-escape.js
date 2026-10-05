// Adapted from Image Picka, Copyright (c) 2017 eight. MIT.
// Modified 2026-10-05: remove Firefox/Android preferences; accept explicit options.
// Full notice: licenses/Image-Picka-MIT.txt

const table = {
  "/": "／",
  "\\": "＼",
  "?": "？",
  "|": "｜",
  "<": "＜",
  ">": "＞",
  ":": "：",
  "\"": "＂",
  "*": "＊",
  "~": "～"
};

const RX_ESCAPE = new RegExp(`[${escapeBracket(Object.keys(table).join(""))}]+`, "g");
// eslint-disable-next-line no-control-regex
const RX_UNPRINTABLE = /[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e]/g;

function escapeBracket(s) {
  return s.replace(/\[|\]/g, "\\$&");
}

export function escapeVariable(name, options = {}) {
  if (options.escapeZWJ) {
    name = name.replace(/\u200d/g, "");
  }
  
  name = trimString(
    name.replace(RX_UNPRINTABLE, "")
      .replace(RX_ESCAPE, m => {
        if (!(options.unicode !== false)) {
          return "_";
        }
        return Array.from(m).map(c => table[c]).join("");
      })
      .replace(/\s+/g, " ")
  );
    
  const maxLength = (options.maxLength || 70);
  if (name.length > maxLength) {
    name = trimString(name.slice(0, maxLength));
  }
  return name;
}

function trimString(s) {
  return s.replace(/^[\s\u180e]+|[\s\u180e]+$/g, "");
}

export function escapePath(path, options = {}) {
  const parts = path.split(/\\|\//g);
  return parts.map((component, i) => {
    component = trimString(component).replace(/^\.+|\.+$/g, m => "．".repeat(m.length))
    if (options.escapeFF127) {
      component = component.replace(/%/g, "％");
      if (i < parts.length - 1) {
        component = component.replace(/\./g, "．");
      }
    }
    return component;
  }
  ).join("/");
}
