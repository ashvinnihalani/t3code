import type {
  ProjectId,
  ProjectOpenPathInEditorInput,
  ProjectExecutionTarget,
  ThreadId,
} from "@t3tools/contracts";
import { resolveMarkdownFileLinkTarget } from "./markdown-links";
import { resolvePathLinkTarget, splitPathAndPosition } from "./terminal-links";

export interface ProjectLinkContext {
  projectId: ProjectId | undefined;
  threadId: ThreadId | undefined;
  referenceRoot: string | undefined;
  host: ProjectExecutionTarget | null | undefined;
}

export type ResolvedEditorTarget =
  | {
      kind: "project-path";
      input: Omit<ProjectOpenPathInEditorInput, "editor">;
      isRemoteProject: boolean;
    }
  | { kind: "shell"; target: string };

function isWindowsPathStyle(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function normalizeAbsolutePath(pathValue: string, separator: "/" | "\\"): string {
  const unified =
    separator === "\\" ? pathValue.replaceAll("/", "\\") : pathValue.replaceAll("\\", "/");
  const parts: string[] = [];
  let prefix = "";
  let remainder = unified;

  if (separator === "\\") {
    const driveMatch = unified.match(/^([A-Za-z]:)(.*)$/);
    if (driveMatch?.[1]) {
      prefix = driveMatch[1].toLowerCase();
      remainder = driveMatch[2] ?? "";
    } else if (unified.startsWith("\\\\")) {
      prefix = "\\\\";
      remainder = unified.slice(2);
    }
  } else if (unified.startsWith("/")) {
    prefix = "/";
    remainder = unified.slice(1);
  }

  for (const segment of remainder.split(/[\\/]+/)) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.length > 0) {
        parts.pop();
      }
      continue;
    }
    parts.push(segment);
  }

  const joined = parts.join(separator);
  if (prefix === "/") {
    return joined.length > 0 ? `/${joined}` : "/";
  }
  if (prefix === "\\\\") {
    return joined.length > 0 ? `\\\\${joined}` : "\\\\";
  }
  if (prefix.length > 0) {
    return joined.length > 0 ? `${prefix}${separator}${joined}` : `${prefix}${separator}`;
  }
  return joined;
}

function joinResolvedPath(base: string, next: string, separator: "/" | "\\"): string {
  const normalizedBase = normalizeAbsolutePath(base, separator).replace(/[\\/]+$/, "");
  const normalizedNext =
    separator === "\\" ? next.replaceAll("/", "\\") : next.replaceAll("\\", "/");
  const trimmedNext = normalizedNext.replace(/^[\\/]+/, "");
  return normalizeAbsolutePath(`${normalizedBase}${separator}${trimmedNext}`, separator);
}

function relativePathWithinRoot(absolutePath: string, rootPath: string): string | null {
  const separator: "/" | "\\" =
    isWindowsPathStyle(absolutePath) || isWindowsPathStyle(rootPath) ? "\\" : "/";
  const normalizedAbsolute = normalizeAbsolutePath(absolutePath, separator);
  const normalizedRoot = normalizeAbsolutePath(rootPath, separator).replace(/[\\/]+$/, "");
  const comparableAbsolute =
    separator === "\\" ? normalizedAbsolute.toLowerCase() : normalizedAbsolute;
  const comparableRoot = separator === "\\" ? normalizedRoot.toLowerCase() : normalizedRoot;

  if (comparableAbsolute === comparableRoot) {
    return ".";
  }
  const rootPrefix = `${comparableRoot}${separator}`;
  if (!comparableAbsolute.startsWith(rootPrefix)) {
    return null;
  }

  const suffix = normalizedAbsolute.slice(normalizedRoot.length + 1);
  return suffix.replaceAll("\\", "/");
}

function toOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toProjectPathInput(
  resolvedTarget: string,
  context: ProjectLinkContext,
): Omit<ProjectOpenPathInEditorInput, "editor"> | null {
  if (!context.projectId || !context.referenceRoot) {
    return null;
  }

  const { path, line, column } = splitPathAndPosition(resolvedTarget);
  const relativePath = relativePathWithinRoot(path, context.referenceRoot);
  if (!relativePath) {
    return null;
  }
  const lineNumber = toOptionalPositiveInt(line);
  const columnNumber = toOptionalPositiveInt(column);

  return {
    projectId: context.projectId,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    relativePath,
    ...(lineNumber ? { line: lineNumber } : {}),
    ...(columnNumber ? { column: columnNumber } : {}),
  };
}

function resolveEditorTargetFromResolvedPath(
  resolvedTarget: string | null,
  context: ProjectLinkContext,
): ResolvedEditorTarget | null {
  if (!resolvedTarget) {
    return null;
  }

  const projectInput = toProjectPathInput(resolvedTarget, context);
  if (projectInput) {
    return {
      kind: "project-path",
      input: projectInput,
      isRemoteProject: Boolean(context.host),
    };
  }

  if (context.host) {
    return null;
  }

  const { path, line, column } = splitPathAndPosition(resolvedTarget);
  const separator: "/" | "\\" =
    isWindowsPathStyle(path) || (context.referenceRoot && isWindowsPathStyle(context.referenceRoot))
      ? "\\"
      : "/";
  const normalizedPath =
    separator === "/" || isWindowsPathStyle(path) ? normalizeAbsolutePath(path, separator) : path;
  return {
    kind: "shell",
    target: `${normalizedPath}${line ? `:${line}` : ""}${column ? `:${column}` : ""}`,
  };
}

export function resolveProjectEditorTargetFromMarkdownHref(
  href: string | undefined,
  context: ProjectLinkContext,
): ResolvedEditorTarget | null {
  return resolveEditorTargetFromResolvedPath(
    resolveMarkdownFileLinkTarget(href, context.referenceRoot),
    context,
  );
}

export function resolveProjectEditorTargetFromRawPath(
  rawPath: string,
  context: ProjectLinkContext,
): ResolvedEditorTarget | null {
  const resolvedTarget = context.referenceRoot
    ? resolvePathLinkTarget(rawPath, context.referenceRoot)
    : rawPath;
  return resolveEditorTargetFromResolvedPath(resolvedTarget, context);
}

export function resolveProjectRelativePathFromAbsolutePath(
  absolutePath: string,
  referenceRoot: string,
): string | null {
  return relativePathWithinRoot(absolutePath, referenceRoot);
}

export function resolveProjectAbsolutePathFromRelativePath(
  relativePath: string,
  referenceRoot: string,
): string {
  const separator: "/" | "\\" = isWindowsPathStyle(referenceRoot) ? "\\" : "/";
  return joinResolvedPath(referenceRoot, relativePath, separator);
}
