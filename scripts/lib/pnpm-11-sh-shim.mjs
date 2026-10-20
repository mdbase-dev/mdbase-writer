// Unchanged generateShShim + helpers from official pnpm@11.15.1,
// @zkochan/cmd-shim@9.0.6. MIT; see docs/native-publisher.md for custody.
// Cached dist/pnpm.mjs SHA256 a42f04caf24d09274405413a31eb43bbb4ba18a61db3968a947e9c9d71ce5e38.
// DATA derivation only. Never executes a generated shim or candidate SDK.
import path14 from 'node:path';
const isWindows5=false;
const isCygwin=()=>false;
function escapeMsysCmdSwitches(args) {
  return args.replace(/(^|\s)\/([CcKk])(\s|$)/g, "$1//$2$3");
}
function generateShShim(src2, to, opts3) {
  let shTarget = path14.relative(path14.dirname(to), src2);
  let shProg = opts3.prog && opts3.prog.split("\\").join("/");
  let shLongProg;
  let shLongProgExe = "";
  let shProgExe = "";
  let shProgHasExe = false;
  shTarget = shTarget.split("\\").join("/");
  const quotedPathToTarget = path14.isAbsolute(shTarget) ? `"${shTarget}"` : `"$basedir/${shTarget}"`;
  const quotedPathToTarget_win = path14.isAbsolute(shTarget) ? `"${shTarget}"` : `"$basedir_win/${shTarget}"`;
  let shTarget_win = "";
  let args = opts3.args || "";
  const isCmdRuntime = opts3.prog === "cmd" || opts3.prog === "cmd.exe";
  const shNodePath = normalizePathEnvVar(opts3.nodePath).posix;
  if (!shProg) {
    shProg = quotedPathToTarget;
    args = "";
    shTarget = "";
  } else if (opts3.prog === "node" && opts3.nodeExecPath) {
    shProg = `"${opts3.nodeExecPath}"`;
    shTarget = /\.exe$/.test(opts3.nodeExecPath) ? quotedPathToTarget_win : quotedPathToTarget;
  } else {
    shProgHasExe = /\.exe$/i.test(shProg);
    shProgExe = shProgHasExe ? shProg : `${shProg}.exe`;
    shLongProg = `"$basedir/${shProg}"`;
    shLongProgExe = `"$basedir/${shProgExe}"`;
    shTarget = quotedPathToTarget;
    shTarget_win = quotedPathToTarget_win;
  }
  let progArgs = opts3.progArgs ? `${opts3.progArgs.join(` `)} ` : "";
  let sh = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
basedir_win="$basedir"
exe=""
msys=""

case \`uname -a\` in
  *CYGWIN*|*MINGW*|*MSYS*)
    if command -v cygpath > /dev/null 2>&1; then
      basedir_win=\`cygpath -w "$basedir"\`
    fi
    exe=".exe"
    msys="true"
  ;;
  *WSL2*)
    if command -v wslpath > /dev/null 2>&1; then
      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"
      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then
        basedir_win="$basedir"
      else
        exe=".exe"
      fi
    fi
  ;;
esac

`;
  if (opts3.prependToPath) {
    sh += `export PATH="${opts3.prependToPath}:$PATH"
`;
  }
  if (shNodePath) {
    sh += `if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="${shNodePath}"
else
  export NODE_PATH="${shNodePath}:$NODE_PATH"
fi
`;
  }
  const generateExecBlock = (execArgs) => {
    if (shLongProg) {
      if (shProgHasExe) {
        return `if [ -x ${shLongProgExe} ]; then
  exec ${shLongProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
else
  exec ${shProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
fi
`;
      } else {
        return `if [ -n "$exe" ] && [ -x ${shLongProgExe} ]; then
  exec ${shLongProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
elif [ -x ${shLongProg} ]; then
  exec ${shLongProg} ${execArgs} ${shTarget} ${progArgs}"$@"
elif command -v ${shProg} >/dev/null 2>&1; then
  exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
elif [ -n "$exe" ] && command -v ${shProgExe} >/dev/null 2>&1; then
  exec ${shProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
else
  exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
fi
`;
      }
    } else {
      return `exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
exit $?
`;
    }
  };
  const msysArgs = isCmdRuntime ? escapeMsysCmdSwitches(args) : args;
  if (msysArgs !== args) {
    sh += `if [ -n "$msys" ]; then
${indentShellBlock(generateExecBlock(msysArgs))}
else
${indentShellBlock(generateExecBlock(args))}
fi
`;
  } else {
    sh += generateExecBlock(args);
  }
  sh += `# ${shimTarget(src2)}
`;
  return sh;
}
function indentShellBlock(script) {
  return script.split("\n").map((line) => line ? `  ${line}` : line).join("\n");
}
function normalizePathEnvVar(nodePath) {
  if (!nodePath || !nodePath.length) {
    return {
      win32: "",
      posix: ""
    };
  }
  let split4 = typeof nodePath === "string" ? nodePath.split(path14.delimiter) : Array.from(nodePath);
  let result2 = {};
  for (let i4 = 0; i4 < split4.length; i4++) {
    const win32 = split4[i4].split("/").join("\\");
    const posix2 = isWindows5 ? split4[i4].split("\\").join("/").replace(/^([^:\\/]*):/, (_, $1) => `${isCygwin() ? "/proc/cygdrive" : "/mnt"}/${$1.toLowerCase()}`) : split4[i4];
    result2.win32 = result2.win32 ? `${result2.win32};${win32}` : win32;
    result2.posix = result2.posix ? `${result2.posix}:${posix2}` : posix2;
    result2[i4] = { win32, posix: posix2 };
  }
  return result2;
}
function shimTarget(src2) {
  return `cmd-shim-target=${src2.split("\\").join("/")}`;
}

export function expectedYamlShim(target,shim,repo) {
 return generateShShim(target,shim,{prog:'node',args:'',nodePath:[path14.join(path14.dirname(target),'node_modules'),path14.dirname(path14.dirname(target)),path14.join(repo,'node_modules/.pnpm/node_modules')]});
}
