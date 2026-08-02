import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { PlayersContext } from "@/contexts/players-context";
import { parseSaveFile } from "@/lib/file";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Dropzone from "react-dropzone";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {useRouter} from "next/router";

interface Props {
	open: boolean;
	setOpen: (open: boolean) => void;
}

type SaveFileHandle = {
	getFile: () => Promise<File>;
};

// react-dropzone (via file-selector) attaches this itself when a dropped
// item supports DataTransferItem.getAsFileSystemHandle() — Chromium-only,
// and only in secure contexts. It's not something we construct ourselves;
// we're just telling TypeScript it might be there.
type DroppedFile = File & { handle?: SaveFileHandle };

type FilePickerWindow = Window &
	typeof globalThis & {
	showOpenFilePicker?: () => Promise<SaveFileHandle[]>;
};

// FileSystemObserver shipped in Chrome/Edge/Opera 133+ (not in Firefox or
// Safari, and not yet in most TS DOM lib versions, hence the manual types).
// It reports file changes as they happen instead of us polling for them —
// this is what lets sync react to Stardew's save-on-sleep almost instantly.
type FileSystemObserverLike = {
	observe: (handle: SaveFileHandle) => Promise<void>;
	disconnect: () => void;
};

type FileSystemObserverWindow = Window &
	typeof globalThis & {
	FileSystemObserver?: new (
		callback: () => void,
	) => FileSystemObserverLike;
};

interface InstructionsDialogProps {
	open: boolean;
	setOpen: (open: boolean) => void;
	platform: "Mac" | "Windows" | "Linux" | "Switch";
}

const InstructionsDialog = ({
								open,
								setOpen,
								platform,
							}: InstructionsDialogProps) => {
	const getInstructions = () => {
		switch (platform) {
			case "Mac":
				return {
					title: "Finding your save file on Mac",
					path: "~/.config/StardewValley/Saves",
					steps: [
						"1. Open Finder",
						"2. Press Cmd + Shift + G",
						"3. Paste this path: ~/.config/StardewValley/Saves",
						"4. Your save files will be in this folder",
						"5. Look for a file named with your farmer's name and a number (e.g. 'Farmer_123456789')",
					],
				};
			case "Windows":
				return {
					title: "Finding your save file on Windows",
					path: "%appdata%\\StardewValley\\Saves",
					steps: [
						"1. Press Windows key + R",
						"2. Paste this path: %appdata%\\StardewValley\\Saves",
						"3. Your save files will be in this folder",
						"4. Look for a file named with your farmer's name and a number (e.g. 'Farmer_123456789')",
					],
				};
			case "Linux":
				return {
					title: "Finding your save file on Linux",
					path: "~/.config/StardewValley/Saves",
					steps: [
						"1. Open your file manager",
						"2. Press Alt + F2",
						"3. Paste this path: ~/.config/StardewValley/Saves",
						"4. Your save files will be in this folder",
						"5. Look for a file named with your farmer's name and a number (e.g. 'Farmer_123456789')",
					],
				};
			case "Switch":
				return {
					title: "Nintendo Switch Save Files",
					path: "",
					steps: [
						"Unfortunately, we don't support direct save file uploading from Nintendo Switch unless your console is modded.",
						"",
						"If you want to track your progress, you'll need to manually enter your achievements and progress in the editor.",
						"",
						"We apologize for any inconvenience this may cause.",
					],
				};
		}
	};

	const instructions = getInstructions();

	// Copy path to clipboard when dialog opens
	if (open && instructions && instructions.path) {
		navigator.clipboard.writeText(instructions.path);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{instructions.title}</DialogTitle>
				</DialogHeader>
				<DialogDescription className="space-y-2">
					{instructions.path && (
						<p className="text-muted-foreground text-sm">
							(We&apos;ve already copied the path to your clipboard!)
						</p>
					)}
					{instructions.steps.map((step, index) => (
						<p key={index}>{step}</p>
					))}
				</DialogDescription>
				<DialogFooter className="sm:justify-left flex flex-col gap-2 sm:flex-row">
					{platform === "Switch" ? (
						<Button onClick={() => setOpen(false)}>Close</Button>
					) : (
						<>
							<Button variant="secondary" asChild>
								<a
									href="https://stardew.app/discord"
									target="_blank"
									rel="noopener noreferrer"
								>
									I need more help...
								</a>
							</Button>
							<Button onClick={() => setOpen(false)}>I found it!</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export const UploadDialog = ({ open, setOpen }: Props) => {
	const router = useRouter();
	const { uploadPlayers } = useContext(PlayersContext);
	const [syncHandle, setSyncHandle] = useState<SaveFileHandle | null>(null);
	const lastSyncedModified = useRef<number | null>(null);
	const [instructionsOpen, setInstructionsOpen] = useState(false);
	const [selectedPlatform, setSelectedPlatform] = useState<
		"Mac" | "Windows" | "Linux" | "Switch"
	>("Mac");

	const uploadFile = useCallback(
		async (file: File, redirectToFarm: boolean) => {
			if (typeof file === "undefined" || !file) return;

			if (file.type !== "") {
				throw new Error("Please select a Stardew Valley save file.");
			}

			const saveText = await file.text();
			const players = parseSaveFile(saveText);
			const farmId = players[0]?.farmId;
			await uploadPlayers(players);

			if (redirectToFarm && farmId) {
				await router.push(`/farm/${farmId}`);
			}
		},
		[router, uploadPlayers],
	);

	// Handles a file from the dropzone. If the browser was able to attach a
	// FileSystemFileHandle to the drop (see DroppedFile above), that handle
	// is durable and re-readable — unlike showOpenFilePicker, dragging a file
	// isn't subject to Chromium's sensitive-directory blocklist, so this
	// works even for files inside %appdata%\StardewValley\Saves. We treat
	// that as "the user just connected auto-sync" with no separate step.
	const handleChange = (file: DroppedFile) => {
		if (typeof file === "undefined" || !file) return;

		setOpen(false);
		toast.promise(uploadFile(file, true), {
			loading: "Uploading your save file...",
			success: file.handle
				? {
					message: "Your save file was successfully uploaded!",
					description:
						"We'll keep this save synced automatically while this tab is open.",
				}
				: "Your save file was successfully uploaded!",
			error: (err) => `There was an error parsing your save file:\n${err}`,
		});

		if (file.handle) {
			lastSyncedModified.current = file.lastModified;
			setSyncHandle(file.handle);
		}
	};

	useEffect(() => {
		if (!syncHandle) return;

		const syncIfChanged = async () => {
			try {
				const file = await syncHandle.getFile();
				if (file.lastModified === lastSyncedModified.current) return;

				await uploadFile(file, false);
				lastSyncedModified.current = file.lastModified;
				toast.success("Save file synced", {
					description: "Your latest Stardew Valley progress is now loaded.",
				});
			} catch (err) {
				console.error("Automatic save sync failed:", err);
			}
		};

		// Safety net: catches changes even if the observer below isn't
		// available, fails to attach, or misses an event (e.g. some cloud-
		// synced save folders don't reliably fire OS-level file events).
		const interval = window.setInterval(() => void syncIfChanged(), 60_000);

		// Primary path: react to the save file changing as it happens,
		// instead of waiting on the next poll. Falls back to just the
		// interval above on Firefox/Safari, where this isn't supported.
		const observerWindow = window as FileSystemObserverWindow;
		let observer: FileSystemObserverLike | undefined;
		if (observerWindow.FileSystemObserver) {
			observer = new observerWindow.FileSystemObserver(() => void syncIfChanged());
			observer.observe(syncHandle).catch((err) => {
				console.error("Could not observe save file for instant sync:", err);
			});
		}

		return () => {
			window.clearInterval(interval);
			observer?.disconnect();
		};
	}, [syncHandle, uploadFile]);

	// Manual fallback for people who'd rather click than drag. This still
	// goes through showOpenFilePicker, so it will still hit the AppData
	// blocklist described in the instructions dialog — kept around for save
	// files that live outside a blocked directory (e.g. after following the
	// junction workaround), or for platforms/setups where that isn't an issue.
	const connectAutomaticSync = async () => {
		const pickerWindow = window as FilePickerWindow;
		if (!pickerWindow.showOpenFilePicker) {
			toast.error("Automatic sync is not supported in this browser", {
				description: "Use a current Chromium-based browser such as Chrome or Edge.",
			});
			return;
		}

		try {
			// Stardew's save files do not have a file extension, so this must allow
			// all files instead of filtering for XML.
			const [handle] = await pickerWindow.showOpenFilePicker();
			const file = await handle.getFile();
			await uploadFile(file, true);
			lastSyncedModified.current = file.lastModified;
			setSyncHandle(handle);
			setOpen(false);
			toast.success("Automatic sync connected", {
				description: "We'll keep this save synced while this tab is open.",
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			toast.error("Could not connect automatic sync", {
				description: err instanceof Error ? err.message : "Unknown error.",
			});
		}
	};

	return (
		<>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Upload your save file</DialogTitle>
					</DialogHeader>
					<DialogDescription>
						<Dropzone
							onDrop={(acceptedFiles) => {
								handleChange(acceptedFiles[0] as DroppedFile);
							}}
							useFsAccessApi={false}
						>
							{({ getRootProps, getInputProps }) => (
								<>
									<input className="h-full w-full" {...getInputProps()} />
									<div className="h-[250px]">
										<div
											{...getRootProps()}
											className="flex h-full w-full cursor-pointer select-none items-center justify-center rounded-lg border-2 border-dashed border-gray-800 dark:border-gray-400"
										>
											<div className="select-text text-center">
												<p>
													Drag and drop your save file here, or click to browse!
												</p>
												<p className="text-muted-foreground mt-2 text-xs">
													Dragging your save file in also keeps it synced
													automatically while this tab is open.
												</p>
											</div>
										</div>
									</div>
								</>
							)}
						</Dropzone>
					</DialogDescription>
					<div className="space-y-2 rounded-md border p-3 text-left">
						<p className="font-medium">Keep this save in sync</p>
						<p className="text-muted-foreground text-sm">
							Choose the original save file to re-read it automatically while this tab is open.
						</p>
						<Button variant="outline" className="w-full" onClick={() => void connectAutomaticSync()}>
							{syncHandle ? "Automatic sync connected" : "Connect automatic sync"}
						</Button>
					</div>
					<div className="space-y-4">
						<div className="text-left">
							<p className="font-medium">Need help finding your save?</p>
							<p className="text-muted-foreground text-sm">
								What do you play on?
							</p>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Button
								variant={"secondary"}
								onClick={() => {
									setSelectedPlatform("Mac");
									setInstructionsOpen(true);
								}}
								className="w-full"
							>
								Mac
							</Button>
							<Button
								variant={"secondary"}
								onClick={() => {
									setSelectedPlatform("Windows");
									setInstructionsOpen(true);
								}}
								className="w-full"
							>
								Windows
							</Button>
							<Button
								variant={"secondary"}
								onClick={() => {
									setSelectedPlatform("Linux");
									setInstructionsOpen(true);
								}}
								className="w-full"
							>
								Linux
							</Button>
							<Button
								variant={"secondary"}
								onClick={() => {
									setSelectedPlatform("Switch");
									setInstructionsOpen(true);
								}}
								className="w-full"
							>
								Nintendo Switch
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
			<InstructionsDialog
				open={instructionsOpen}
				setOpen={setInstructionsOpen}
				platform={selectedPlatform}
			/>
		</>
	);
};