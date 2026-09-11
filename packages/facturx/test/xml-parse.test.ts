import { describe, expect, it } from 'vitest';
import { parseXml, XmlParseError } from '../src/index.js';

describe('parseXml', () => {
  it('lit éléments, attributs, texte, entités, CDATA, commentaires et PI', () => {
    const root = parseXml(
      `﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<a x="1 &amp; 2" y='q"'><b>t &lt; &#233; &#xE9; &gt;</b><!-- skip --><c><![CDATA[<raw> & stuff]]></c><?pi data?><d/>tail</a>`,
    );
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ x: '1 & 2', y: 'q"' });
    expect(root.children.map((c) => c.local)).toEqual(['b', 'c', 'd']);
    expect(root.children[0]?.text).toBe('t < é é >');
    expect(root.children[1]?.text).toBe('<raw> & stuff');
    expect(root.text).toBe('tail');
  });

  it('résout les namespaces par préfixe, y compris remappés et par défaut', () => {
    const root = parseXml(
      `<n1:root xmlns:n1="urn:a" xmlns="urn:def"><n1:x/><y/><z xmlns="urn:z"><w/></z><n1:v xmlns:n1="urn:b"/></n1:root>`,
    );
    expect(root.ns).toBe('urn:a');
    expect(root.local).toBe('root');
    const [x, y, z, v] = root.children;
    expect(x?.ns).toBe('urn:a');
    expect(y?.ns).toBe('urn:def');
    expect(z?.ns).toBe('urn:z');
    expect(z?.children[0]?.ns).toBe('urn:z');
    expect(v?.ns).toBe('urn:b');
  });

  it('refuse DOCTYPE, préfixe inconnu, entité inconnue et documents mal formés avec ligne/colonne', () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow(/DOCTYPE/);
    expect(() => parseXml('<p:a/>')).toThrow(/Préfixe de namespace non déclaré/);
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(/Entité inconnue/);
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a>')).toThrow(/non fermé/);
    expect(() => parseXml('')).toThrow(/vide/);
    expect(() => parseXml('<a/><b/>')).toThrow(/Un seul élément racine/);
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/dupliqué/);
    expect(() => parseXml('<a x=1/>')).toThrow(/non délimitée/);
    let caught: unknown;
    try {
      parseXml('<a>\n  <b>\n  </c>\n</a>');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(XmlParseError);
    expect((caught as XmlParseError).line).toBe(3);
    expect((caught as XmlParseError).column).toBe(3);
  });

  it('borne la profondeur', () => {
    const deep = `${'<a>'.repeat(300)}${'</a>'.repeat(300)}`;
    expect(() => parseXml(deep)).toThrow(/Profondeur/);
    expect(() => parseXml(deep, { maxDepth: 400 })).not.toThrow();
  });

  it('accepte des octets UTF-8', () => {
    const root = parseXml(new TextEncoder().encode('<a>é€</a>'));
    expect(root.text).toBe('é€');
  });
});
