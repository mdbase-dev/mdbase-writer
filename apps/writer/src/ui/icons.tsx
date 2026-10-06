// Phosphor icons, as Editor uses them, under Writer's names. Each carries the .icon
// sizing class and stays hidden from assistive technology.
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowSquareOutIcon as PhArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { ArticleIcon as PhArticle } from "@phosphor-icons/react/Article";
import { CaretDownIcon as PhCaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon as PhCaretUp } from "@phosphor-icons/react/CaretUp";
import { CaretLeftIcon as PhCaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon as PhCaretRight } from "@phosphor-icons/react/CaretRight";
import { CheckIcon as PhCheck } from "@phosphor-icons/react/Check";
import { CodeIcon as PhCode } from "@phosphor-icons/react/Code";
import { ColumnsIcon as PhColumns } from "@phosphor-icons/react/Columns";
import { DotsSixVerticalIcon as PhDotsSixVertical } from "@phosphor-icons/react/DotsSixVertical";
import { DotsThreeIcon as PhDotsThree } from "@phosphor-icons/react/DotsThree";
import { DownloadSimpleIcon as PhDownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileTextIcon as PhFileText } from "@phosphor-icons/react/FileText";
import { GearSixIcon as PhGearSix } from "@phosphor-icons/react/GearSix";
import { KeyboardIcon as PhKeyboard } from "@phosphor-icons/react/Keyboard";
import { LinkSimpleIcon as PhLinkSimple } from "@phosphor-icons/react/LinkSimple";
import { ListBulletsIcon as PhListBullets } from "@phosphor-icons/react/ListBullets";
import { MagnifyingGlassIcon as PhMagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { MinusIcon as PhMinus } from "@phosphor-icons/react/Minus";
import { PencilSimpleIcon as PhPencilSimple } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon as PhPlus } from "@phosphor-icons/react/Plus";
import { SidebarSimpleIcon as PhSidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { TextBIcon as PhTextB } from "@phosphor-icons/react/TextB";
import { TextItalicIcon as PhTextItalic } from "@phosphor-icons/react/TextItalic";
import { WarningCircleIcon as PhWarningCircle } from "@phosphor-icons/react/WarningCircle";
import { XIcon as PhX } from "@phosphor-icons/react/X";

type P = { className?: string };

function icon(Glyph: PhosphorIcon) {
  return ({ className }: P) => <Glyph className={["icon", className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

export const ChevronDown = icon(PhCaretDown);
export const ChevronUp = icon(PhCaretUp);
export const ChevronLeft = icon(PhCaretLeft);
export const ChevronRight = icon(PhCaretRight);
export const SidebarIcon = icon(PhSidebarSimple);
export const EditorOnly = icon(PhArticle);
export const SplitIcon = icon(PhColumns);
export const PageIcon = icon(PhFileText);
export const GearIcon = icon(PhGearSix);
export const DownloadIcon = icon(PhDownloadSimple);
export const AlertIcon = icon(PhWarningCircle);
export const CheckIcon = icon(PhCheck);
export const CloseIcon = icon(PhX);
export const PlusIcon = icon(PhPlus);
export const MinusIcon = icon(PhMinus);
export const KeyboardIcon = icon(PhKeyboard);
export const MoreIcon = icon(PhDotsThree);
export const SearchIcon = icon(PhMagnifyingGlass);
export const OutlineIcon = icon(PhListBullets);
export const PenIcon = icon(PhPencilSimple);
export const GripIcon = icon(PhDotsSixVertical);
export const ExternalIcon = icon(PhArrowSquareOut);
export const BoldIcon = icon(PhTextB);
export const ItalicIcon = icon(PhTextItalic);
export const CodeIcon = icon(PhCode);
export const LinkIcon = icon(PhLinkSimple);
