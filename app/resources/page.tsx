'use client';

import { useEffect, useState, useRef } from 'react';
import { deleteResource, updateResource } from '@/lib/actions/resources';
import Link from 'next/link';

type Resource = {
  id: string;
  title?: string | null;
  content: string;
  source: string;
  metadata?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 20;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<'note' | 'document' | 'person' | 'project' | 'skill' | 'learning' | 'schedule' | 'event' | 'other'>('note');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadResources = async (page: number = currentPage) => {
    try {
      setLoading(true);
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      if (typeFilter) params.append('type', typeFilter);
      
      const res = await fetch(`/api/resources?${params}`);
      const data = await res.json();
      
      if (data.ok) {
        setResources(data.resources);
        setTotalCount(data.pagination.total);
        setHasMore(data.pagination.hasMore);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error('Error loading resources:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    loadResources(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    
    const result = await deleteResource(id);
    if (result.success) {
      setResources(prev => prev.filter(r => r.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));
      
      // If current page becomes empty and not first page, go to previous page
      if (resources.length === 1 && currentPage > 1) {
        loadResources(currentPage - 1);
      } else if (resources.length === 1) {
        // Reload current page if it becomes empty
        loadResources(currentPage);
      }
    } else {
      alert(result.message || 'Failed to delete resource');
    }
  };

  const handleEdit = (resource: Resource) => {
    setEditingId(resource.id);
    setEditTitle(resource.title || '');
    setEditContent(resource.content);
    const currentType = getTypeLabel(resource.metadata);
    setEditType(currentType as 'note' | 'document' | 'person' | 'project' | 'skill' | 'learning' | 'schedule' | 'event' | 'other');
  };

  const handleSave = async (id: string) => {
    const result = await updateResource(id, {
      title: editTitle || undefined,
      content: editContent,
      metadata: { type: editType },
    });
    
    if (result.success) {
      setResources(prev => prev.map(r => 
        r.id === id 
          ? { 
              ...r, 
              title: editTitle || null, 
              content: editContent, 
              metadata: { ...r.metadata, type: editType },
              updatedAt: new Date() 
            }
          : r
      ));
      setEditingId(null);
      setEditTitle('');
      setEditContent('');
      setEditType('note');
    } else {
      alert(result.message || 'Failed to update resource');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
    setEditType('note');
  };

  // Client-side search filter (only filters by text, type is already filtered on backend)
  const filteredResources = resources.filter(r => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (r.title?.toLowerCase().includes(query)) ||
      r.content.toLowerCase().includes(query)
    );
  });

  const getTypeLabel = (metadata: any) => {
    if (!metadata || typeof metadata !== 'object') return 'note';
    return metadata.type || 'note';
  };

  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const MAX_FILE_SIZE_MB = 10;
    const maxSizeBytes = MAX_FILE_SIZE_MB * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      alert(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE_MB}MB`);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['pdf', 'docx', 'txt', 'md'];
    if (!ext || !allowedExts.includes(ext)) {
      alert(`Unsupported file type. Supported types: ${allowedExts.join(', ').toUpperCase()}`);
      return;
    }

    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/resources/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.ok) {
        setUploadProgress(`✓ Successfully uploaded ${file.name}`);
        // Reload resources to show the new one
        setTimeout(() => {
          loadResources(currentPage);
          setUploadProgress('');
        }, 1000);
      } else {
        setUploadProgress(`✗ Error: ${result.message || 'Upload failed'}`);
        setTimeout(() => setUploadProgress(''), 3000);
      }
    } catch (error) {
      setUploadProgress(`✗ Error: ${error instanceof Error ? error.message : 'Upload failed'}`);
      setTimeout(() => setUploadProgress(''), 3000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md"
            onChange={handleFileUpload}
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary btn-sm"
            disabled={uploading}
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-4 h-4 mr-2 stroke-current">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                Upload File
              </>
            )}
          </button>
          <Link href="/tables" className="btn btn-outline btn-sm">
            My Tables
          </Link>
          <Link href="/" className="btn btn-outline btn-sm">
            Back to Chat
          </Link>
        </div>
      </div>

      {uploadProgress && (
        <div className={`alert ${uploadProgress.startsWith('✓') ? 'alert-success' : uploadProgress.startsWith('✗') ? 'alert-error' : 'alert-info'} shadow-lg`}>
          <div>
            <span>{uploadProgress}</span>
          </div>
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search resources..."
            className="input input-bordered w-full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="select select-bordered"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="note">Notes</option>
          <option value="document">Documents</option>
          <option value="person">People</option>
          <option value="project">Projects</option>
          <option value="skill">Skills</option>
          <option value="learning">Learning</option>
          <option value="schedule">Schedule</option>
        </select>
      </div>

      {loading && resources.length === 0 ? (
        <div className="text-center py-8">Loading resources...</div>
      ) : filteredResources.length === 0 ? (
        <div className="text-center py-8 text-base-content/70">
          {searchQuery ? 'No resources match your search' : 'No resources found'}
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {filteredResources.map((resource) => (
              <div key={resource.id} className="card bg-base-100 shadow">
                <div className="card-body">
                  {editingId === resource.id ? (
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Title (optional)"
                        className="input input-bordered w-full"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <select
                        className="select select-bordered w-full"
                        value={editType}
                        onChange={(e) => setEditType(e.target.value as typeof editType)}
                      >
                        <option value="note">Note</option>
                        <option value="document">Document</option>
                        <option value="person">Person</option>
                        <option value="project">Project</option>
                        <option value="skill">Skill</option>
                        <option value="learning">Learning</option>
                        <option value="schedule">Schedule</option>
                        <option value="event">Event</option>
                        <option value="other">Other</option>
                      </select>
                      <textarea
                        className="textarea textarea-bordered w-full min-h-[200px]"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="card-actions justify-end">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={handleCancel}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSave(resource.id)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h2 className="card-title text-lg">
                              {resource.title || '(No title)'}
                            </h2>
                            <span className="badge badge-outline badge-sm">
                              {getTypeLabel(resource.metadata)}
                            </span>
                          </div>
                          <p className="text-sm text-base-content/70 mb-2">
                            {formatDate(resource.createdAt)}
                          </p>
                          <div className="prose max-w-none">
                            <p className="whitespace-pre-wrap break-words">
                              {resource.content.length > 500
                                ? `${resource.content.substring(0, 500)}...`
                                : resource.content}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="card-actions justify-end mt-4">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleEdit(resource)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-error"
                          onClick={() => handleDelete(resource.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!searchQuery && (
            <div className="flex flex-col items-center justify-center gap-4 mt-6">
              {(() => {
                const totalPages = Math.ceil(totalCount / limit);
                
                // Show pagination buttons only if more than 1 page
                if (totalPages > 1) {
                  return (
                    <div className="join">
                      <button
                        className="join-item btn btn-sm btn-outline"
                        onClick={() => loadResources(currentPage - 1)}
                        disabled={loading || currentPage === 1}
                      >
                        Previous
                      </button>
                      
                      {(() => {
                        const maxVisiblePages = 10;
                        const pages: (number | string)[] = [];
                        
                        if (totalPages <= maxVisiblePages) {
                          // Show all pages
                          return Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              className={`join-item btn btn-sm ${currentPage === page ? 'btn-active' : ''}`}
                              onClick={() => loadResources(page)}
                              disabled={loading}
                            >
                              {page}
                            </button>
                          ));
                        }
                        
                        // Smart pagination with ellipsis for more than 10 pages
                        // Always show first page
                        pages.push(1);
                        
                        // Show ellipsis if needed
                        if (currentPage > 4) {
                          pages.push('...');
                        }
                        
                        // Show pages around current page (2 on each side)
                        const start = Math.max(2, currentPage - 2);
                        const end = Math.min(totalPages - 1, currentPage + 2);
                        
                        for (let i = start; i <= end; i++) {
                          if (i !== 1 && i !== totalPages) {
                            pages.push(i);
                          }
                        }
                        
                        // Show ellipsis if needed
                        if (currentPage < totalPages - 3) {
                          pages.push('...');
                        }
                        
                        // Always show last page
                        pages.push(totalPages);
                        
                        return pages.map((page, idx) => {
                          if (page === '...') {
                            return (
                              <button
                                key={`ellipsis-${idx}`}
                                className="join-item btn btn-sm btn-disabled"
                                disabled
                              >
                                ...
                              </button>
                            );
                          }
                          return (
                            <button
                              key={page}
                              className={`join-item btn btn-sm ${currentPage === page ? 'btn-active' : ''}`}
                              onClick={() => loadResources(page as number)}
                              disabled={loading}
                            >
                              {page}
                            </button>
                          );
                        });
                      })()}
                      
                      <button
                        className="join-item btn btn-sm btn-outline"
                        onClick={() => loadResources(currentPage + 1)}
                        disabled={loading || !hasMore}
                      >
                        Next
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              
              <span className="text-sm text-base-content/70">
                Showing {totalCount === 0 ? 0 : ((currentPage - 1) * limit) + 1}-{Math.min(currentPage * limit, totalCount)} of {totalCount}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

