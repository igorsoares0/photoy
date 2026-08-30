/** Minimal test harness shared by the engine suites. */

export function createSuite(name) {
  const results = [];
  let failures = 0;

  return {
    name,
    async check(label, run) {
      try {
        await run();
        results.push(`  PASS  ${label}`);
      } catch (error) {
        failures += 1;
        results.push(`  FAIL  ${label}\n        ${error.message}`);
      }
    },
    report() {
      console.log(`\n${name}`);
      console.log(results.join('\n'));
      return failures;
    },
  };
}

/** Reads one RGBA pixel out of a preview payload. */
export function pixelAt(payload, stride, x, y) {
  const offset = y * stride + x * 4;
  return [payload[offset], payload[offset + 1], payload[offset + 2], payload[offset + 3]];
}

/** True when every channel is within `tolerance` of the expected value. */
export function channelsClose(actual, expected, tolerance) {
  return expected.every((value, index) => Math.abs(actual[index] - value) <= tolerance);
}

/** Searches a buffer for an ASCII marker, e.g. an ICC segment identifier. */
export function containsMarker(buffer, marker) {
  return buffer.includes(Buffer.from(marker, 'ascii'));
}
