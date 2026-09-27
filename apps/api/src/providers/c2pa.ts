import type { Config } from '../config.ts';

export const DIGITAL_CAPTURE = 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture';
export const AI_SOURCE_TYPES = [
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
  'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia',
];

/** Formats c2pa-rs can embed a manifest in; others are left unsigned. */
const SIGNABLE: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/heic': 'image/heic',
  'image/png': 'image/png',
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
};
export const signableType = (contentType: string): string | undefined => SIGNABLE[contentType];

export interface CaptureClaim {
  title: string;
  capturedAt: Date;
  /** Custom assertion `app.itp.checkin`: where and how the capture was proven. */
  checkin: Record<string, unknown>;
}

export interface ManifestSummary {
  /** Active manifest label, signer common name, and c2pa-rs validation state (Valid, Trusted, Invalid). */
  label: string | null;
  signer: string | null;
  generator: string | null;
  validationState: string | null;
  /** Validation failures other than an untrusted signer (a demo CA is expected to be untrusted). */
  failures: string[];
  /** IPTC digital source types declared by the actions, e.g. trainedAlgorithmicMedia for AI images. */
  sourceTypes: string[];
  assertions: string[];
}

/** C2PA Content Credentials: sign in-app captures, read any manifest a file already carries. */
export interface Credentials {
  readonly name: string;
  readonly canSign: boolean;
  sign(data: Buffer, contentType: string, claim: CaptureClaim): Promise<Buffer>;
  /** Null when the file carries no manifest (or cannot be parsed). */
  read(data: Buffer, contentType: string): Promise<ManifestSummary | null>;
}

type C2pa = typeof import('@contentauth/c2pa-node');
let lib: Promise<C2pa> | undefined;
/** The native module loads on first use, so a missing binary never stops the API from booting. */
const load = () => {
  lib ??= import('@contentauth/c2pa-node');
  return lib;
};

const pem = (s: string) => Buffer.from(s.replace(/\\n/g, '\n'));

interface RawManifest {
  label?: string;
  claim_generator_info?: { name?: string }[];
  claim_generator?: string;
  signature_info?: { common_name?: string; issuer?: string };
  assertions?: { label: string; data?: { actions?: { digitalSourceType?: string }[] } }[];
}

async function readManifest(data: Buffer, contentType: string): Promise<ManifestSummary | null> {
  const { Reader } = await load();
  let reader: Awaited<ReturnType<C2pa['Reader']['fromAsset']>>;
  try {
    reader = await Reader.fromAsset({
      buffer: data,
      mimeType: signableType(contentType) ?? contentType,
    });
  } catch {
    return null;
  }
  if (!reader) return null;
  const store = reader.json() as {
    validation_state?: string;
    validation_status?: { code: string }[];
  };
  const active = reader.getActive() as RawManifest | undefined;
  if (!active) return null;
  const actions = (active.assertions ?? []).filter((a) => a.label.startsWith('c2pa.actions'));
  return {
    label: active.label ?? null,
    signer: active.signature_info?.common_name ?? active.signature_info?.issuer ?? null,
    generator: active.claim_generator_info?.[0]?.name ?? active.claim_generator ?? null,
    validationState: store.validation_state ?? null,
    failures: (store.validation_status ?? [])
      .map((s) => s.code)
      .filter((c) => c !== 'signingCredential.untrusted'),
    sourceTypes: [
      ...new Set(
        actions.flatMap((a) =>
          (a.data?.actions ?? []).flatMap((x) =>
            x.digitalSourceType ? [x.digitalSourceType] : [],
          ),
        ),
      ),
    ],
    assertions: (active.assertions ?? []).map((a) => a.label),
  };
}

/** Reads manifests but has no signing certificate configured. */
export class ReadOnlyCredentials implements Credentials {
  readonly name: string = 'read-only';
  readonly canSign: boolean = false;
  async sign(_data: Buffer, _contentType: string, _claim: CaptureClaim): Promise<Buffer> {
    throw new Error('C2PA signing is not configured (C2PA_CERT_PEM / C2PA_KEY_PEM)');
  }
  read(data: Buffer, contentType: string) {
    return readManifest(data, contentType);
  }
}

export class C2paCredentials extends ReadOnlyCredentials {
  override readonly name = 'c2pa';
  override readonly canSign = true;
  constructor(
    private certChain: Buffer,
    private key: Buffer,
    private version: string,
  ) {
    super();
  }

  override async sign(data: Buffer, contentType: string, claim: CaptureClaim): Promise<Buffer> {
    const mimeType = signableType(contentType);
    if (!mimeType) throw new Error(`C2PA cannot embed in ${contentType}`);
    const { Builder, LocalSigner } = await load();
    const signer = LocalSigner.newSigner(this.certChain, this.key, 'es256');
    const builder = await Builder.withJsonAsync({
      claim_generator_info: [{ name: 'Incentivize the Physical', version: this.version }],
      title: claim.title,
      assertions: [
        {
          label: 'c2pa.actions',
          data: {
            actions: [
              {
                action: 'c2pa.created',
                digitalSourceType: DIGITAL_CAPTURE,
                when: claim.capturedAt.toISOString(),
                softwareAgent: { name: 'Incentivize the Physical in-app camera' },
              },
            ],
          },
        },
        { label: 'app.itp.checkin', data: claim.checkin },
      ],
    } as never);
    const out: { buffer: Buffer | null } = { buffer: null };
    builder.sign(signer, { buffer: data, mimeType }, out);
    if (!out.buffer) throw new Error('C2PA signing produced no output');
    return out.buffer;
  }
}

export function createCredentials(c: Config): Credentials {
  return c.C2PA_CERT_PEM && c.C2PA_KEY_PEM
    ? new C2paCredentials(pem(c.C2PA_CERT_PEM), pem(c.C2PA_KEY_PEM), '0.1.0')
    : new ReadOnlyCredentials();
}
