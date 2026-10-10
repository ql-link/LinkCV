import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiRequestError, type SharedCompany } from "../../api/client";
import { CompaniesPage } from "./CompaniesPage";
import { adminPageFromPath } from "./AdminApp";

const company: SharedCompany = { id: "10", name: "示例科技", aliases: ["Example Tech"], logo_url: "https://cdn.example.test/old.png", logo_source: "official", lock_version: "4" };
beforeEach(() => {
  vi.spyOn(api, "listSharedCompanies").mockResolvedValue({ items: [company] });
  vi.spyOn(api, "updateSharedCompany").mockImplementation(async (_company, changes) => ({ ...company, ...changes, lock_version: "5" }));
});

it("routes to company management and searches aliases", async () => {
  expect(adminPageFromPath("/admin/companies")).toBe("companies");
  render(<CompaniesPage />);
  await screen.findByText("示例科技");
  fireEvent.change(screen.getByLabelText("搜索公司名称或别名"), { target: { value: "EXAMPLE" } });
  expect(screen.getByRole("button", { name: "管理示例科技匹配" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索公司名称或别名"), { target: { value: "不存在" } });
  expect(screen.getByText("没有符合条件的公司")).toBeInTheDocument();
});

it("cancels alias changes and saves only the confirmed edit with a version", async () => {
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "管理示例科技匹配" }));
  fireEvent.click(screen.getByRole("button", { name: "移除别名Example Tech" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(api.updateSharedCompany).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "管理示例科技匹配" }));
  expect(screen.getByRole("button", { name: "移除别名Example Tech" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("添加公司别名"), { target: { value: "示例品牌" } });
  fireEvent.click(screen.getByRole("button", { name: "保存匹配" }));
  await waitFor(() => expect(api.updateSharedCompany).toHaveBeenCalledWith(company, { aliases: ["Example Tech", "示例品牌"] }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("rejects unsafe Logo URLs and keeps failed edits available for retry", async () => {
  vi.mocked(api.updateSharedCompany).mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "更换示例科技图标" }));
  fireEvent.change(screen.getByLabelText("新图标地址"), { target: { value: "http://cdn.example.test/new.png" } });
  fireEvent.click(screen.getByRole("button", { name: "保存图标" }));
  expect(screen.getByText("请输入不含账号密码的 HTTPS 图片地址。")).toBeInTheDocument();
  expect(api.updateSharedCompany).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("新图标地址"), { target: { value: "https://cdn.example.test/new.png" } });
  fireEvent.click(screen.getByRole("button", { name: "保存图标" }));
  expect(await screen.findByText("操作未完成，请重试。")).toBeInTheDocument();
  expect(screen.getByLabelText("新图标地址")).toHaveValue("https://cdn.example.test/new.png");
  fireEvent.click(screen.getByRole("button", { name: "保存图标" }));
  await waitFor(() => expect(api.updateSharedCompany).toHaveBeenCalledTimes(2));
});

it("refreshes on a stale company version instead of retrying an overwrite", async () => {
  vi.mocked(api.updateSharedCompany).mockRejectedValue(new ApiRequestError(409, "COMPANY_CONFLICT"));
  render(<CompaniesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "管理示例科技匹配" }));
  fireEvent.click(screen.getByRole("button", { name: "保存匹配" }));
  expect(await screen.findByText("公司资料已被更新，请重新编辑。")).toBeInTheDocument();
  await waitFor(() => expect(api.listSharedCompanies).toHaveBeenCalledTimes(2));
  expect(api.updateSharedCompany).toHaveBeenCalledTimes(1);
});
