import { useState, useCallback } from 'react';

type PanelType = 'templates' | 'myResumes' | 'assets' | 'settings';

export function usePanelState() {
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isMyResumesOpen, setIsMyResumesOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const closeAllPanels = useCallback(() => {
    setIsTemplatesOpen(false);
    setIsMyResumesOpen(false);
    setIsAssetsOpen(false);
    setIsSettingsOpen(false);
  }, []);

  const togglePanel = useCallback((panel: PanelType) => {
    const panelStates = {
      templates: isTemplatesOpen,
      myResumes: isMyResumesOpen,
      assets: isAssetsOpen,
      settings: isSettingsOpen,
    };

    if (panelStates[panel]) {
      closeAllPanels();
    } else {
      closeAllPanels();
      switch (panel) {
        case 'templates':
          setIsTemplatesOpen(true);
          break;
        case 'myResumes':
          setIsMyResumesOpen(true);
          break;
        case 'assets':
          setIsAssetsOpen(true);
          break;
        case 'settings':
          setIsSettingsOpen(true);
          break;
      }
    }
  }, [isTemplatesOpen, isMyResumesOpen, isAssetsOpen, isSettingsOpen, closeAllPanels]);

  const openTemplates = useCallback(() => {
    closeAllPanels();
    setIsTemplatesOpen(true);
  }, [closeAllPanels]);

  const openMyResumes = useCallback(() => {
    closeAllPanels();
    setIsMyResumesOpen(true);
  }, [closeAllPanels]);

  const openAssets = useCallback(() => {
    closeAllPanels();
    setIsAssetsOpen(true);
  }, [closeAllPanels]);

  const openSettings = useCallback(() => {
    closeAllPanels();
    setIsSettingsOpen(true);
  }, [closeAllPanels]);

  return {
    isTemplatesOpen,
    isMyResumesOpen,
    isAssetsOpen,
    isSettingsOpen,
    togglePanel,
    openTemplates,
    openMyResumesOpen: openMyResumes,
    openAssets,
    openSettings,
    closeAllPanels,
  };
}
