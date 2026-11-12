import { useEffect, useMemo, useState } from "react";
import { api, type PartFacets, type ProjectOption } from "../api/api";
import type { ComboOption } from "./Combobox";
import { loadLocalMachines } from "../job/machine";
import { techMaterials, techThicknesses } from "../job/technology";

/** Materials, thicknesses and projects for the drop-down lists, loaded once per form. */
export function usePickLists(material: string) {
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  useEffect(() => {
    api.partFacets().then(setFacets).catch(() => undefined);
    api.projectOptions().then(setProjects).catch(() => undefined);
  }, []);

  const lists = useMemo(() => {
    const m = material.trim().toLowerCase();
    // thicknesses used with the chosen material; all of them while no material is chosen
    const known = facets.thicknesses.filter((t) => !m || t.material.toLowerCase() === m);
    const thick = [...new Set((known.length ? known : facets.thicknesses).map((t) => t.thicknessMm))].sort((a, b) => a - b);
    return {
      materials: facets.materials.map((v): ComboOption => ({ value: v })),
      thicknesses: thick.map((t): ComboOption => ({ value: String(t), label: `${t} mm` })),
      projects: projects.map((p): ComboOption => ({ value: p.code, hint: [p.name, p.customer].filter(Boolean).join(" · ") || undefined })),
    };
  }, [facets, projects, material]);

  // what the machines' Technology tables have (a new part's or sheet's material and thickness come
  // from there; with no material tags anywhere yet, anything can be typed as before)
  const tech = useMemo(() => {
    const sets = loadLocalMachines().list.map((m) => m.technologies);
    const mats = techMaterials(sets);
    const thick = techThicknesses(sets, mats.length ? material : "");
    const strict = mats.length > 0;
    const canonMaterial = (v: string) => mats.find((x) => x.toLowerCase() === v.trim().toLowerCase());
    return {
      /** only the Technology tables' materials and thicknesses can be chosen */
      strict,
      techMaterials: mats.map((v): ComboOption => ({ value: v })),
      techThicknesses: thick.map((t): ComboOption => ({ value: String(t), label: `${t} mm` })),
      /** the material as the Technology table spells it (undefined: not there) */
      canonMaterial,
      materialOk: (v: string) => !strict || !!canonMaterial(v),
      thicknessOk: (v: string | number) => !strict || thick.some((t) => Math.abs(t - Number(v)) < 1e-6),
    };
  }, [material]);

  /** Is this project saved in the database (empty = no project, also fine)? */
  const projectKnown = (code: string) => !code.trim() || projects.some((p) => p.code.toLowerCase() === code.trim().toLowerCase());

  /** Saves a new project and adds it to the list. */
  const createProject = async (code: string) => {
    const p = await api.createProject(code);
    setProjects((list) => [p, ...list]);
  };

  return { ...lists, ...tech, projectKnown, createProject, projectsLoaded: projects.length > 0 };
}
