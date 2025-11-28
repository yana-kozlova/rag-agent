'use client';

import { useEffect, useState } from 'react';
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
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<'note' | 'document' | 'person' | 'project' | 'skill' | 'learning' | 'schedule' | 'event' | 'other'>('note');

  const loadResources = async (reset = false) => {
    try {
      setLoading(true);
      const currentOffset = reset ? 0 : offset;
      const params = new URLSearchParams({
        limit: '20',
        offset: currentOffset.toString(),
      });
      if (typeFilter) params.append('type', typeFilter);
      
      const res = await fetch(`/api/resources?${params}`);
      const data = await res.json();
      
      if (data.ok) {
        if (reset) {
          setResources(data.resources);
          setOffset(data.resources.length);
        } else {
          setResources(prev => [...prev, ...data.resources]);
          setOffset(prev => prev + data.resources.length);
        }
        setHasMore(data.pagination.hasMore);
      }
    } catch (error) {
      console.error('Error loading resources:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOffset(0);
    loadResources(true);
  }, [typeFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    
    const result = await deleteResource(id);
    if (result.success) {
      setResources(prev => prev.filter(r => r.id !== id));
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

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <Link href="/" className="btn btn-outline btn-sm">
          Back to Chat
        </Link>
      </div>

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

          {hasMore && !searchQuery && (
            <div className="text-center">
              <button
                className="btn btn-outline"
                onClick={() => loadResources(false)}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

