/** How a person looks; the 3D figures and their portraits are built from this. */
export type HairStyle = "short" | "long" | "bun" | "curly" | "cap" | "buzz" | "pony" | "bob";

export interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  shirt: string;
  accent?: string;
  pants: string;
  shoes?: string;
  glasses?: boolean;
  cap?: string;
  prop?: "tablet" | "mug" | null;
}
