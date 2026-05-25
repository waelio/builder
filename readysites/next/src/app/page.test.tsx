import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the starter content and navigation links", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        name: /to get started, edit the page\.tsx file\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /templates/i }),
    ).toHaveAttribute("href", expect.stringContaining("vercel.com/templates"));
    expect(
      screen.getByRole("link", { name: /documentation/i }),
    ).toHaveAttribute("href", expect.stringContaining("nextjs.org/docs"));
  });
});
