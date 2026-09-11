import { describe, expect, it } from 'vitest';
import { el, elA, serializeXml, XmlError } from '../src/index.js';

describe('el / elA', () => {
  it('ignore undefined, null, false et aplatit les tableaux', () => {
    const node = el('a', undefined, null, false, [el('b'), [el('c', 'x')]], 'txt');
    expect(node.children.map((c) => (typeof c === 'string' ? c : c.name))).toEqual([
      'b',
      'c',
      'txt',
    ]);
  });

  it('omet les attributs undefined et refuse les noms invalides', () => {
    expect(elA('a', { x: '1', y: undefined }).attrs).toEqual({ x: '1' });
    expect(() => el('1bad')).toThrow(XmlError);
    expect(() => el('a b')).toThrow(XmlError);
    expect(() => elA('a', { 'bad name': '1' })).toThrow(XmlError);
    expect(() => el('ram:ID')).not.toThrow();
  });
});

describe('serializeXml', () => {
  const tree = elA(
    'r',
    { 'xmlns:x': 'urn:x', q: 'a"b' },
    el('e'),
    el('t', 'v<1'),
    el('n', el('m', '1'), el('m', '2')),
  );

  it('compact par défaut, avec déclaration', () => {
    expect(serializeXml(tree)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><r xmlns:x="urn:x" q="a&quot;b"><e/><t>v&lt;1</t><n><m>1</m><m>2</m></n></r>',
    );
  });

  it('pretty : un élément par ligne, texte inline', () => {
    expect(serializeXml(tree, { pretty: true, declaration: false })).toBe(
      [
        '<r xmlns:x="urn:x" q="a&quot;b">',
        '  <e/>',
        '  <t>v&lt;1</t>',
        '  <n>',
        '    <m>1</m>',
        '    <m>2</m>',
        '  </n>',
        '</r>',
        '',
      ].join('\n'),
    );
  });

  it('est déterministe', () => {
    expect(serializeXml(tree)).toBe(serializeXml(tree));
  });
});
