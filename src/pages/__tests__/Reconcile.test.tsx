import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Reconcile } from "../Reconcile";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useReconcileStore } from "../../store/reconcileStore";

const mockLoad = vi.mocked(load);
const mockInvoke = invoke as Mock;
const mockOpen = open as Mock;

const renderReconcile = () => {
  return render(
    <MemoryRouter>
      <Reconcile />
    </MemoryRouter>
  );
};

describe("Reconcile Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store state between tests
    useReconcileStore.setState({
      laptopRoot: null,
      driveRoot: null,
      sdRoot: null,
      status: "idle",
      operationId: null,
      logs: [],
      progress: null,
      report: null,
    });

    const mockStore = {
      get: vi.fn((key: string) => {
        const data: Record<string, string | unknown> = {
          archivePath: "/test/archive",
          backupPath: "/test/backup",
        };
        return Promise.resolve(data[key]);
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
    };

    mockLoad.mockResolvedValue(mockStore as unknown as Awaited<ReturnType<typeof load>>);
    mockOpen.mockResolvedValue(null);

    // Mock reconcile report response
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "run_reconcile") {
        return Promise.resolve({
          folders: [
            {
              folder: "2026-04-25",
              laptop_count: 5,
              drive_count: 4,
              sd_count: 0,
              safe_to_free_count: 4,
              safe_to_free_bytes: 4096,
              at_risk_count: 1,
              at_risk_bytes: 1024,
            },
          ],
          files: [
            {
              rel_path: "2026-04-25/safe.jpg",
              file_name: "safe.jpg",
              size: 4096,
              on_laptop: true,
              on_drive: true,
              on_sd: false,
              classification: "SafeToFree",
            },
            {
              rel_path: "2026-04-25/at_risk.jpg",
              file_name: "at_risk.jpg",
              size: 1024,
              on_laptop: true,
              on_drive: false,
              on_sd: false,
              classification: "AtRisk",
            },
          ],
          total_reclaimable_bytes: 4096,
          total_at_risk_bytes: 1024,
          laptop_root: "/test/archive",
          drive_root: "/test/backup",
          sd_root: null,
          warnings: [],
        });
      }
      return Promise.resolve();
    });
  });

  it("renders page header and layout", async () => {
    renderReconcile();

    expect(screen.getByText("Free Local Space")).toBeInTheDocument();
    expect(screen.getByText(/Compare local working files/i)).toBeInTheDocument();
  });

  it("loads paths from store on mount", async () => {
    renderReconcile();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Select Laptop Archive Root...")).toHaveValue("/test/archive");
    });
  });

  it("triggers scanning operations and displays summaries", async () => {
    renderReconcile();

    // Wait for settings to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Select Laptop Archive Root...")).toHaveValue("/test/archive");
    });

    const scanBtn = screen.getByText("Reconcile / Scan");
    await userEvent.click(scanBtn);

    // Verify invoke was called
    expect(mockInvoke).toHaveBeenCalledWith("run_reconcile", expect.any(Object));

    // Wait for the report elements to display
    await waitFor(() => {
      expect(screen.getAllByText("4 KB")[0]).toBeInTheDocument(); // Reclaimable bytes
      expect(screen.getAllByText("1 KB")[0]).toBeInTheDocument(); // At risk bytes
      expect(screen.getByText("2026-04-25")).toBeInTheDocument(); // Folder breakdown folder name
    });
  });

  it("handles folder expand/collapse and trashing actions", async () => {
    renderReconcile();

    // Wait for settings to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Select Laptop Archive Root...")).toHaveValue("/test/archive");
    });

    // Trigger scan first to get the report
    await userEvent.click(screen.getByText("Reconcile / Scan"));

    await waitFor(() => {
      expect(screen.getByText("2026-04-25")).toBeInTheDocument();
    });

    // Expand folder
    const folderRow = screen.getByText("2026-04-25");
    await userEvent.click(folderRow);

    // Verify files within expanded list are visible
    expect(screen.getByText("2026-04-25/safe.jpg")).toBeInTheDocument();
    expect(screen.getByText("2026-04-25/at_risk.jpg")).toBeInTheDocument();

    // Click trash button (within folder summary context)
    const trashBtn = screen.getAllByTitle("Free local staging files")[0];
    await userEvent.click(trashBtn);

    // Modal should be visible
    expect(screen.getByText("Confirm Trashing Local Files")).toBeInTheDocument();
  });
});
