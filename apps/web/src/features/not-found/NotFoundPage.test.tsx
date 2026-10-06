import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InAppNotFound, NotFoundPage } from "./NotFoundPage";

describe("NotFoundPage", () => {
  it("网页端 404：公共首页入口、登录入口和返回上一页", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(screen.getByText("不存在")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到首页/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: /返回上一页/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "了解 LinkResume" })).toHaveAttribute("href", "/");
  });

  it("应用内 404：回到工作台首页，并给出三个常用入口", () => {
    render(<InAppNotFound />);

    expect(screen.getByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到首页/ })).toHaveAttribute("href", "/assistant");
    expect(screen.getByRole("link", { name: "我的简历" })).toHaveAttribute("href", "/resumes");
    expect(screen.getByRole("link", { name: "岗位看板" })).toHaveAttribute("href", "/career/applications");
    expect(screen.getByRole("link", { name: "面试日程" })).toHaveAttribute("href", "/career/schedule");
    expect(screen.queryByRole("link", { name: "登录" })).not.toBeInTheDocument();
  });
});
