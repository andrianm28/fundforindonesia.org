import { render, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import QuickActionTiles from "./QuickActionTiles";

const mockTiles = [
  { icon: "💰", label: "Donasi", href: "/donasi", color: "#E3F2FD" },
  { icon: "🕌", label: "Zakat", href: "/zakat", color: "#E8F5E9" },
  { icon: "📢", label: "Galang Dana", href: "/galang-dana", color: "#FFF3E0" },
  {
    icon: "🔄",
    label: "Donasi Otomatis",
    href: "/donasi-otomatis",
    color: "#F3E5F5",
  },
  {
    icon: "✨",
    label: "Fund for Indonesia Experience",
    href: "/experience",
    color: "#E0F7FA",
  },
  {
    icon: "🤝",
    label: "Kolaborasi CSR",
    href: "/kolaborasi-csr",
    color: "#FCE4EC",
  },
  {
    icon: "🛡️",
    label: "Asuransi SalingJaga",
    href: "/asuransi",
    color: "#E8EAF6",
  },
];

describe("QuickActionTiles", () => {
  it("renders all tiles with labels", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const section = container.querySelector("section")!;
    const scope = within(section);

    expect(scope.getByText("Donasi")).toBeInTheDocument();
    expect(scope.getByText("Zakat")).toBeInTheDocument();
    expect(scope.getByText("Galang Dana")).toBeInTheDocument();
    expect(scope.getByText("Donasi Otomatis")).toBeInTheDocument();
    expect(scope.getByText("Fund for Indonesia Experience")).toBeInTheDocument();
    expect(scope.getByText("Kolaborasi CSR")).toBeInTheDocument();
    expect(scope.getByText("Asuransi SalingJaga")).toBeInTheDocument();
  });

  it("renders correct icons for each tile", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const section = container.querySelector("section")!;
    const scope = within(section);

    expect(scope.getByLabelText("Donasi")).toHaveTextContent("💰");
    expect(scope.getByLabelText("Zakat")).toHaveTextContent("🕌");
    expect(scope.getByLabelText("Galang Dana")).toHaveTextContent("📢");
  });

  it("renders links with correct href values", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const section = container.querySelector("section")!;
    const links = section.querySelectorAll("a");

    expect(links).toHaveLength(mockTiles.length);
    expect(links[0]).toHaveAttribute("href", "/donasi");
    expect(links[1]).toHaveAttribute("href", "/zakat");
    expect(links[2]).toHaveAttribute("href", "/galang-dana");
    expect(links[3]).toHaveAttribute("href", "/donasi-otomatis");
  });

  it("applies the correct background color to icon containers", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const section = container.querySelector("section")!;
    const scope = within(section);

    const donasiIcon = scope.getByLabelText("Donasi").parentElement;
    expect(donasiIcon).toHaveStyle({ backgroundColor: "#E3F2FD" });

    const zakatIcon = scope.getByLabelText("Zakat").parentElement;
    expect(zakatIcon).toHaveStyle({ backgroundColor: "#E8F5E9" });
  });

  it("renders a 5-column grid layout", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);
    const grid = container.querySelector(".grid");

    expect(grid).toHaveClass("grid-cols-5");
  });

  // A bare <section> is anonymous; the tiles region is named so the e2e specs
  // (and a screen reader) can address it without guessing at its position.
  it("names the tiles region", () => {
    const { container } = render(<QuickActionTiles tiles={mockTiles} />);

    expect(container.querySelector("section")).toHaveAttribute(
      "aria-label",
      "Quick action tiles"
    );
  });

  it("renders empty grid when no tiles provided", () => {
    const { container } = render(<QuickActionTiles tiles={[]} />);
    const links = container.querySelectorAll("a");

    expect(links).toHaveLength(0);
  });

  it("renders a coming-soon tile as a non-link, muted, honestly-labeled tile", () => {
    const tilesWithComingSoon = [
      { icon: "💰", label: "Donasi", href: "/donasi", color: "#E3F2FD" },
      { icon: "✨", label: "Volunteer", comingSoon: true as const },
    ];
    const { container } = render(<QuickActionTiles tiles={tilesWithComingSoon} />);
    const section = container.querySelector("section")!;
    const scope = within(section);

    expect(scope.getByText("Volunteer")).toBeInTheDocument();
    expect(scope.getByText("Segera hadir")).toBeInTheDocument();

    const links = section.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/donasi");
  });

  it("does not render an href anywhere for a coming-soon tile", () => {
    const tilesWithComingSoon = [
      { icon: "🤝", label: "Kolaborasi CSR", comingSoon: true as const },
    ];
    const { container } = render(<QuickActionTiles tiles={tilesWithComingSoon} />);
    const anchors = container.querySelectorAll("a[href]");
    expect(anchors).toHaveLength(0);
  });
});
