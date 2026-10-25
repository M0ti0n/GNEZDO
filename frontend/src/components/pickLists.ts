import { useEffect, useMemo, useState } from "react";
import { api, type PartFacets, type ProjectOption } from "../api/api";
import type { ComboOption } from "./Combobox";

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

  /** Is this project saved in the database (empty = no project, also fine)? */
  const projectKnown = (code: string) => !code.trim() || projects.some((p) => p.code.toLowerCase() === code.trim().toLowerCase());

  /** Saves a new project and adds it to the list. */
  const createProject = async (code: string) => {
    const p = await api.createProject(code);
    setProjects((list) => [p, ...list]);
  };

  return { ...lists, projectKnown, createProject, projectsLoaded: projects.length > 0 };
}
