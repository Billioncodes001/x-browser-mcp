import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function route(page: Page, id: string, title: string) {
  await page.goto("/#" + id);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function overflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
test("all dashboard routes render and assets load without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [id, title] of [
    ["overview", "A little more perspective."],
    ["setup", "Make yourself at home."],
    ["research", "Follow a question."],
    ["searches", "Keep the questions that matter."],
    ["collections", "A record you can return to."],
    ["actions", "Consider it before you send it."],
  ]) {
    await route(page, id, title);
    await overflow(page);
  }
  await route(page, "overview", "A little more perspective.");
  expect(
    await page
      .locator(".hero-photo img")
      .evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.route("**/api/state", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Reload the local dashboard to establish a new session.",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Reload the local dashboard",
  );
  await page.unroute("**/api/state");
  await page
    .getByRole("button", { name: "Reload workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A little more perspective.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).not.toBeVisible();
});
test("setup persists preferences and connects the fixture browser", async ({
  page,
}) => {
  await route(page, "setup", "Make yourself at home.");
  await page
    .getByLabel("Delay between page operations (milliseconds)")
    .fill("1800");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator(".toast")).toContainText(
    "Browser preferences saved",
  );
  await page.reload();
  await expect(
    page.getByLabel("Delay between page operations (milliseconds)"),
  ).toHaveValue("1800");
  await page
    .getByRole("button", { name: "Open X browser", exact: true })
    .click();
  await expect(page.locator(".session-note")).toContainText("fixture");
  await expect(
    page.getByRole("button", { name: "Save preferences" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Close browser", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save preferences" }),
  ).toBeEnabled();
});
test("saved searches run, preserve untrusted text and export original records", async ({
  page,
}) => {
  await route(page, "searches", "Keep the questions that matter.");
  await page
    .getByLabel("Search name", { exact: true })
    .fill("browser-research");
  await page.getByLabel("Query", { exact: true }).fill("public research");
  await page.getByRole("button", { name: "Save search", exact: true }).click();
  await expect(page.locator(".saved-heading")).toContainText(
    "browser-research",
  );
  await page.getByRole("button", { name: "Run search", exact: true }).click();
  await expect(page).toHaveURL(/#snapshot\//);
  await expect(page.locator(".record-text")).toContainText(
    "<script>window.compromised=true</script>",
  );
  expect(await page.evaluate(() => "compromised" in window)).toBe(false);
  await page.getByLabel("Filter records").fill("no such record");
  await expect(
    page.getByRole("heading", { name: "No records to show" }),
  ).toBeVisible();
  await page.getByLabel("Filter records").fill("");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/x-collection-.*\.csv/);
  await page.getByText("All captured fields", { exact: true }).click();
  await expect(page.locator(".details pre")).toContainText("12345");
});
test("direct research collects a bounded sample and collection comparisons work", async ({
  page,
}) => {
  await route(page, "research", "Follow a question.");
  await page
    .getByLabel("Search query", { exact: true })
    .fill("public research");
  await page.getByRole("button", { name: "Collect records" }).click();
  await expect(page).toHaveURL(/#snapshot\//);
  await expect(
    page.getByText("records collected", { exact: true }),
  ).toBeVisible();
  await route(page, "collections", "A record you can return to.");
  await page.getByRole("button", { name: "Compare collections" }).click();
  await expect(page.locator(".comparison-counts")).toContainText(
    "Not observed",
  );
});
test("reviewed actions require confirmation and create receipts without live account writes", async ({
  page,
}) => {
  await route(page, "setup", "Make yourself at home.");
  await page
    .getByLabel(
      "Allow account actions after reviewing and confirming each preview",
    )
    .check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator(".toast")).toContainText(
    "Browser preferences saved",
  );
  await page
    .getByRole("button", { name: "Open X browser", exact: true })
    .click();
  await expect(page.locator(".session-note")).toContainText("fixture");
  await route(page, "actions", "Consider it before you send it.");
  await page.getByLabel("Expected account handle").fill("fixture_user");
  await page
    .getByLabel("Exact text", { exact: true })
    .fill("Synthetic action; never sent to X.");
  await page.getByRole("button", { name: "Prepare preview" }).click();
  await expect(page.locator(".drafts blockquote")).toContainText(
    "Synthetic action",
  );
  await expect(
    page.getByRole("button", { name: "Confirm & execute" }),
  ).toBeDisabled();
  await page.getByLabel(/I authorize this exact action/).check();
  await page.getByRole("button", { name: "Confirm & execute" }).click();
  await expect(page.locator(".receipt-list")).toContainText("verified");
  await expect(
    page.getByRole("heading", { name: "No pending previews" }),
  ).toBeVisible();
  await route(page, "setup", "Make yourself at home.");
  await page
    .getByRole("button", { name: "Close browser", exact: true })
    .click();
  await page
    .getByLabel(
      "Allow account actions after reviewing and confirming each preview",
    )
    .uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
});
test("desktop and mobile layouts pass keyboard, reduced motion and accessibility checks", async ({
  page,
}) => {
  await route(page, "overview", "A little more perspective.");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await overflow(page);
    await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
    if (width < 1024) await expect(page.locator(".sidebar")).toBeHidden();
    await page.screenshot({
      path: "artifacts/dashboard-" + width + ".png",
      fullPage: true,
      animations: "disabled",
    });
    if (width === 1440 || width === 320) {
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.failureSummary),
        })),
      ).toEqual([]);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("link", { name: "Browser setup", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document
        .getElementById("workspace-navigation")
        ?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Browser setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await overflow(page);
});
