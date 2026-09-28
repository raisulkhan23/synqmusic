import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const admin = readSource("src/pages/Admin.tsx");
const adminConvex = readSource("src/convex/admin.ts");

/** The listUsers query, which is what the accounts table is built from. */
function fn(name) {
  const start = adminConvex.indexOf(`export const ${name} = query({`);
  if (start === -1) throw new Error(`missing ${name}`);
  const end = adminConvex.indexOf("\n});", start);
  return adminConvex.slice(start, end === -1 ? undefined : end);
}

describe("the accounts table can be narrowed by sign-in method", () => {
  test("the backend already reports each account's providers and GitHub id", () => {
    // The filter has nothing to work with without these two fields.
    const listUsers = fn("listUsers");
    expect(listUsers).toMatch(/providers:/);
    expect(listUsers).toMatch(/githubId:/);
  });

  test("GitHub is one of the offered methods", () => {
    expect(admin).toMatch(/id: "github", label: "GitHub"/);
  });

  test("the filter matches on the provider list, not on the role", () => {
    // Role and sign-in method are independent: a GitHub user can be a standard
    // user, and an admin can have signed in with Google.
    expect(admin).toMatch(
      /if \(userMethod !== "all" && !\(u\.providers \?\? \[\]\)\.includes\(userMethod\)\)/,
    );
    expect(admin).toMatch(
      /\[users, userQuery, userRole, userMethod, userSort\]/,
    );
  });

  test("the method dropdown is labelled and offers every method plus 'any'", () => {
    expect(admin).toMatch(/aria-label="Filter by sign-in method"/);
    expect(admin).toMatch(/<option value="all">Any sign-in<\/option>/);
    expect(admin).toMatch(/SIGN_IN_METHODS\.map\(\(method\)/);
  });

  test("each option carries the number of accounts using it", () => {
    // Without a count the admin cannot tell an empty filter from a broken one.
    expect(admin).toMatch(
      /\{method\.label\} \(\{methodCounts\[method\.id\] \?\? 0\}\)/,
    );
    expect(admin).toMatch(/counts\[p\] = \(counts\[p\] \?\? 0\) \+ 1;/);
  });
});

describe("a GitHub account can be looked up by its external id", () => {
  test("the search box matches the GitHub id as well as name and email", () => {
    // The row badge shows the GitHub id, so searching for it has to work.
    expect(admin).toMatch(
      /const github = \(u\.githubId \?\? ""\)\.toLowerCase\(\);/,
    );
    expect(admin).toMatch(/github\.includes\(q\)/);
  });

  test("the placeholder says the GitHub id is searchable", () => {
    expect(admin).toMatch(/placeholder="Search name, email or GitHub id…"/);
  });
});
