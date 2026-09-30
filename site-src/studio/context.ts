/**
 * Ce que l'application calcule depuis l'état et partage avec ses composants : la facture
 * construite, les anomalies (saisie, SDK, police), la mise en page de l'aperçu, le verdict des
 * validateurs officiels.
 */

import type { InvoiceLayout } from 'facturx-sdk/pdf';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { FailedAssert } from '../validateur/analyze.js';
import type { LoadedFonts } from './fonts.js';
import type { BuildResult } from './model.js';
import type { Assets } from './pipeline.js';
import type { FieldIssue } from './ui.js';

export interface StudioIssue extends FieldIssue {
  /** Chemin dans la facture (anomalies du SDK) ou dans le formulaire (saisie). */
  path: string;
  source: 'input' | 'sdk' | 'glyph';
}

export type JudgeId = 'cen' | 'facturx' | 'brfr';

export interface JudgeResult {
  id: JudgeId;
  status: 'ok' | 'failed' | 'skipped';
  failures: (FailedAssert & {
    severity: 'fatal' | 'warning' | 'tolerated';
    reason?: string | undefined;
  })[];
  note?: string;
}

export interface OfficialState {
  status: 'idle' | 'waiting' | 'running' | 'done' | 'error';
  judges: JudgeResult[];
  /** Le XML jugé ; si la facture a changé depuis, le verdict est périmé. */
  xml?: string;
  error?: string;
}

export interface Derived {
  built: BuildResult;
  issues: StudioIssue[];
  /** XML CII de la facture, quand elle est conforme pour le SDK. */
  xml: string | undefined;
  layout: InvoiceLayout | undefined;
  layoutError: string | undefined;
  layoutPending: boolean;
  fonts: LoadedFonts | undefined;
  logoUrl: string | undefined;
  official: OfficialState;
  runOfficial: () => void;
  /** Police et logo prêts pour le SDK ; absents tant que la police se charge. */
  assets: Assets | undefined;
}

export const DerivedContext = createContext<Derived | undefined>(undefined);

export function useDerived(): Derived {
  const derived = useContext(DerivedContext);
  if (!derived) throw new Error('DerivedContext absent');
  return derived;
}
