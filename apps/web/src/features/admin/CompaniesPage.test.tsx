import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiRequestError, type SharedCompany } from "../../api/client";
import { CompaniesPage } from "./CompaniesPage";
import { adminPageFromPath } from "./AdminApp";

const company: SharedCompany = { id: "10", name: "示例科技", aliases: ["Example Tech"], logo_url: "/api/company-logos/" + "a".repeat(64) + ".webp", logo_source: "official", lock_version: "4" };
const bare: SharedCompany = { id: "11", name: "示例制造", aliases: [], logo_url: null, logo_source: "unknown", lock_version: "1" };

beforeEach(() => {
  vi.spyOn(api, "listSharedCompanies").mockResolvedValue({ items: [company, bare] });
  vi.spyOn(api, "listUnmatchedCompanyNames").mockResolvedValue({ items: [{ id: "7", name: "示例科技（上海）有限公司", hit_count: 14, last_seen_at: "2026-01-01T00:00:00Z" }] });
  vi.spyOn(api, "listLogoFingerprints").mockImplementation(async (status) => ({ items: status === "suspected"
    ? [{ id: "3", image_url: "/api/company-logos/" + "b".repeat(64) + ".webp", company_count: 23, sample_names: ["示例科技", "示例制造", "示例能源"], status: "suspected" }] : [] }));
  vi.spyOn(api, "updateSharedCompany").mockImplementation(async (_company, changes) => ({ ...company, ...changes, logo_source: "admin", lock_version: "5" } as SharedCompany));
  vi.spyOn(api, "uploadSharedCompanyLogo").mockResolvedValue({ ...company, logo_source: "admin", lock_version: "5" });
  vi.spyOn(api, "assignUnmatchedCompanyName").mockResolvedValue({ ...company, aliases: ["Example Tech", "示例科技（上海）有限公司"], lock_version: "5" });
  vi.spyOn(api, "ignoreUnmatchedCompanyName").mockResolvedValue(undefined);
  vi.spyOn(api, "reviewLogoFingerprint").mockResolvedValue({ id: "3", status: "placeholder", cleared_company_count: 20 });
});

it("routes to company management, filters by logo source and searches aliases", async () => {
  expect(adminPageFromPath("/admin/companies")).toBe("companies");
  render(<CompaniesPage />);
  expect(await screen.findByText("企业官网")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /暂无图标/ }));
  expect(screen.queryByText("企业官网")).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: "编辑示例制造" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /全部/ }));
  fireEvent.change(screen.getByLabelText("搜索公司名称 / 别名"), { target: { value: "EXAMPLE" } });
  expect(screen.getByRole("row", { name: "编辑示例科技" })).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: "编辑示例制造" })).not.toBeInTheDocument();
});

it("saves aliases and a logo address together with the current version", async () => {
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("row", { name: "编辑示例科技" }));
  const dialog = await screen.findByRole("dialog", { name: "编辑公司 · 示例科技" });
  expect(within(dialog).getByText("当前来自企业官网")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "移除别名Example Tech" }));
  fireEvent.change(within(dialog).getByLabelText("添加公司别名"), { target: { value: "示例品牌" } });
  fireEvent.keyDown(within(dialog).getByLabelText("添加公司别名"), { key: "Enter" });
  fireEvent.click(within(dialog).getByRole("button", { name: "填写图片地址" }));
  fireEvent.change(within(dialog).getByLabelText("图片地址"), { target: { value: "http://cdn.example.test/new.png" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "读取" }));
  expect(within(dialog).getByText("请输入不含账号密码的 HTTPS 图片地址。")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("图片地址"), { target: { value: "https://cdn.example.test/new.png" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "读取" }));
  expect(within(dialog).getByText("新图标已读取 · 保存后生效")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateSharedCompany).toHaveBeenCalledWith(company, { aliases: ["示例品牌"], logo_url: "https://cdn.example.test/new.png" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(within(screen.getByRole("row", { name: "编辑示例科技" })).getByText("管理员设置")).toBeInTheDocument();
});

it("uploads a file before saving aliases and can clear a logo", async () => {
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("row", { name: "编辑示例科技" }));
  let dialog = await screen.findByRole("dialog");
  const file = new File(["fictional"], "logo.png", { type: "image/png" });
  globalThis.URL.createObjectURL ??= () => "blob:fictional";
  fireEvent.change(within(dialog).getByLabelText("上传公司图标"), { target: { files: [file] } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.uploadSharedCompanyLogo).toHaveBeenCalledWith(company, file));
  expect(api.updateSharedCompany).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("row", { name: "编辑示例科技" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "清除图标" }));
  expect(within(dialog).getByText(/图标将被清除/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateSharedCompany).toHaveBeenLastCalledWith(expect.objectContaining({ lock_version: "5" }), { logo_url: null }));
});

it("refreshes on a stale company version instead of retrying an overwrite", async () => {
  vi.mocked(api.updateSharedCompany).mockRejectedValue(new ApiRequestError(409, "COMPANY_CONFLICT"));
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("row", { name: "编辑示例科技" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("添加公司别名"), { target: { value: "示例品牌" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  expect(await screen.findByText("公司资料已被更新，请重新编辑。")).toBeInTheDocument();
  await waitFor(() => expect(api.listSharedCompanies).toHaveBeenCalledTimes(2));
  expect(api.updateSharedCompany).toHaveBeenCalledTimes(1);
});

it("assigns or ignores unmatched names", async () => {
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("tab", { name: /待匹配名称/ }));
  expect(await screen.findByText("示例科技（上海）有限公司")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "将示例科技（上海）有限公司归入公司" }));
  const list = await screen.findByRole("listbox", { name: "选择公司" });
  expect(within(list).getAllByRole("option")[0]).toHaveTextContent("示例科技名称相近");
  fireEvent.click(within(list).getAllByRole("option")[0]!);
  await waitFor(() => expect(api.assignUnmatchedCompanyName).toHaveBeenCalledWith("7", company));
  fireEvent.click(screen.getByRole("button", { name: "忽略" }));
  await waitFor(() => expect(api.ignoreUnmatchedCompanyName).toHaveBeenCalledWith("7"));
});

it("reviews suspected placeholder images", async () => {
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("tab", { name: /疑似默认图/ }));
  // Names are stored up to 20 per image, so larger counts read as "20+".
  expect(await screen.findByText("20+ 家公司使用")).toBeInTheDocument();
  expect(screen.getByText("示例科技、示例制造、示例能源 等")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "标记为默认图" }));
  await waitFor(() => expect(api.reviewLogoFingerprint).toHaveBeenCalledWith("3", "mark-placeholder"));
  fireEvent.click(screen.getByRole("button", { name: "不是默认图" }));
  await waitFor(() => expect(api.reviewLogoFingerprint).toHaveBeenLastCalledWith("3", "allow"));
});
