import type { writerDeployments } from "./deployment-environment.mjs";

export type WriterBuildTarget = keyof typeof writerDeployments;

export declare const writerSdkPins: Readonly<Record<WriterBuildTarget, string>>;

export declare function writerSdkTarget(environment: Record<string, string | undefined>): WriterBuildTarget | undefined;

export declare function packagedRelease(moduleSource: string): {
  environment: string;
  cpOrigin: string;
  logOrigin: string;
  assetSha256: string;
};

export declare function verifiedWriterSdk(
  target: WriterBuildTarget,
  root?: string,
  app?: string,
): Promise<{
  target: WriterBuildTarget;
  name: string;
  root: string;
  aliases: { find: RegExp; replacement: string }[];
  offlineShellUrl: string;
  connectOrigin: string;
}>;
