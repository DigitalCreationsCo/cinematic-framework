import { useEffect, useRef } from 'react';
import type { Scene } from '#shared/types/workflow.types';
import { getAllBestFromAssets } from '#shared/utils/utils';

export function useMediaPreloader(scenes: Scene[], currentSceneId?: string) {
    const preloadedUrls = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!scenes.length) return;

        const currentIndex = scenes.findIndex(s => s.id === currentSceneId);

        // If no scene selected, maybe just preload the first one?
        // Or if we are at -1, we might not be playing. 
        // Let's assume if currentIndex is -1, we might be at start or just nothing selected.

        const targetIndex = currentIndex === -1 ? 0 : currentIndex;

        // Define window of interest: Current + Next 2
        // We also might want to keep Previous 1 warm if possible, but browser cache handles that well.
        const scenesToPreload = scenes.slice(targetIndex, targetIndex + 3);

        scenesToPreload.forEach((scene, index) => {
            // Priority 1: Images (Thumbnails)
            const startFrame = getAllBestFromAssets(scene.assets)[ 'scene_start_frame' ]?.data;
            if (startFrame) preloadImage(startFrame);

            // Priority 2: Video
            // Only preload video for the immediate next scene to save bandwidth, 
            // or the current one if it's not fully loaded yet.
            // We'll preload next 2 videos but maybe sequentially? 
            // For now, let's just trigger preload for next 2.
            const video = getAllBestFromAssets(scene.assets)[ 'scene_video' ]?.data;
            if (video) {
                preloadVideo(video);
            }

            // Priority 3: End frames (often used for hover or transition)
            const endFrame = getAllBestFromAssets(scene.assets)[ 'scene_end_frame' ]?.data;
            if (endFrame) preloadImage(endFrame);
        });

    }, [ scenes, currentSceneId ]);

    const preloadImage = (url: string) => {
        if (preloadedUrls.current.has(url)) return;

        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = url;
        document.head.appendChild(link);

        // Backup method using Image object
        const img = new Image();
        img.src = url;

        preloadedUrls.current.add(url);
    };

    const preloadVideo = (url: string) => {
        if (preloadedUrls.current.has(url)) return;

        // Using <link rel="preload" as="video"> is the most "resource-light" way 
        // as it respects the browser's download manager better than creating hidden video elements.
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'video';
        link.href = url;
        link.type = 'video/mp4'; // Assumption, but safe for generated videos usually
        document.head.appendChild(link);

        // Also create a detached video element to force buffering if preload link is ignored (some browsers)
        // We only do this for the *immediate* next video to minimize memory usage
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.src = url;

        preloadedUrls.current.add(url);
    };
}
