// Generic, all-or-nothing installation of function wraps over another
// module's surface (Monk's Enhanced Journal). libWrapper is used when the
// lib-wrapper module is active AND the spec carries a globalThis-rooted
// path; everything else (and every libWrapper failure) takes the manual
// prototype patch, which keeps the original for uninstall. No Foundry
// globals: the caller supplies libWrapperModule/libWrapper/moduleId/warn.
//
// Wrapper convention on both branches, matching libWrapper's:
//   wrapper.call(thisArg, wrappedBoundToThis, ...args)
// and the wrapper's return value is returned as-is (a promise from an async
// original stays a promise; a plain value stays plain).

/** Internal: tolerates a missing or throwing env.warn; no-op when absent. */
function safeWarn(env, msg, err) {
  try {
    env.warn?.(msg, err);
  } catch {
    // Silently ignore if warn throws or is missing; don't break rollback/uninstall.
  }
}

/**
 * @param {Array<{name:string, object:object, key:string, path?:string, wrapper:Function}>} specs
 * @param {{libWrapperModule?:{active?:boolean}, libWrapper?:object, moduleId:string, warn:(msg:string, err?:any)=>void}} env
 * @returns {{installed:string[], failed:string|null, records:object[]}}
 */
export function installWraps(specs, env) {
  const records = [];
  for (const spec of specs) {
    try {
      records.push(installOne(spec, env));
    } catch (err) {
      safeWarn(env, `wrap "${spec.name}" could not be installed; uninstalling ${records.length} already installed`, err);
      uninstallWraps(records, env);
      return { installed: [], failed: spec.name, records: [] };
    }
  }
  return { installed: records.map((r) => r.name), failed: null, records };
}

function installOne(spec, env) {
  const { name, object, key, path, wrapper } = spec;
  if (typeof object?.[key] !== "function") {
    throw new Error(`target ${name} (${key}) is not a function`);
  }
  if (path && env.libWrapperModule?.active && env.libWrapper) {
    try {
      env.libWrapper.register(env.moduleId, path, wrapper, "WRAPPER");
      return { name, kind: "libwrapper", path };
    } catch (err) {
      safeWarn(env, `libWrapper.register failed for ${path}; falling back to manual patch`, err);
    }
  }
  const original = object[key];
  object[key] = function (...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  return { name, kind: "manual", object, key, original };
}

/** Reverse-order uninstall of what installWraps returned. */
export function uninstallWraps(records, env) {
  for (const r of [...records].reverse()) {
    if (r.kind === "libwrapper") {
      if (!env.libWrapper) {
        safeWarn(env, `libWrapper is unavailable; path ${r.path} stays registered`, undefined);
      } else {
        try { env.libWrapper.unregister(env.moduleId, r.path); } catch (err) { safeWarn(env, `libWrapper.unregister failed for ${r.path}`, err); }
      }
    } else {
      r.object[r.key] = r.original;
    }
  }
}
